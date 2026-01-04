package main

import (
	"context"
	"sort"
)

// FeaturedProduct represents a product for the featured section
type FeaturedProduct struct {
	ID           string  `json:"id"`
	Title        string  `json:"title"`
	Price        float64 `json:"price"`
	VendorID     string  `json:"vendor_id"`
	VendorName   string  `json:"vendor_name"`
	Link         string  `json:"link"`
	Thumbnail    string  `json:"thumbnail"`
	BrandName    string  `json:"brand_name"`
	GroupKey     string  `json:"group_key"`
	DosageValue  float64 `json:"dosage_value"`
	DosageUnit   string  `json:"dosage_unit"`
	Rank         int     `json:"rank"`
}

// FeaturedGroup represents a grouped product for featured section
type FeaturedGroup struct {
	ID             string            `json:"id"`
	NormalizedName string            `json:"normalized_name"`
	DosageValue    float64           `json:"dosage_value,omitempty"`
	DosageUnit     string            `json:"dosage_unit,omitempty"`
	Products       []FeaturedProduct `json:"products"`
	PriceRange     struct {
		Min float64 `json:"min"`
		Max float64 `json:"max"`
		Avg float64 `json:"avg"`
	} `json:"price_range"`
	VendorCount   int `json:"vendor_count"`
	ProductCount  int `json:"product_count"`
}

// GetFeaturedProducts returns featured products - groups with most vendors
func (s *server) GetFeaturedProducts(ctx context.Context, limit int) ([]FeaturedGroup, error) {
	// Query database for product groups with the most vendors
	// Use LATERAL join to limit products per group for performance
	query := `
		WITH top_groups AS (
			SELECT
				p."computedGroupId" as group_key,
				MIN(p."normalizedName") as normalized_name,
				MIN(p."dosageValue") as dosage_value,
				MIN(p."dosageUnit") as dosage_unit,
				COUNT(DISTINCT p."vendorId") as vendor_count,
				COUNT(*) as product_count,
				MIN(p.price) as min_price,
				MAX(p.price) as max_price,
				AVG(p.price) as avg_price
			FROM "Product" p
			WHERE p."computedGroupId" IS NOT NULL
			  AND p."computedGroupId" != ''
			  AND p.price > 0
			GROUP BY p."computedGroupId"
			HAVING COUNT(DISTINCT p."vendorId") > 1
			   AND COUNT(*) < 100
			   AND COUNT(*) / COUNT(DISTINCT p."vendorId") < 5
			ORDER BY COUNT(DISTINCT p."vendorId") DESC
			LIMIT $1
		)
		SELECT
			g.group_key,
			g.normalized_name,
			g.dosage_value,
			g.dosage_unit,
			g.vendor_count,
			g.product_count,
			g.min_price,
			g.max_price,
			g.avg_price,
			p.id,
			p.title,
			p.price,
			p."vendorId" as vendor_id,
			v.name as vendor_name,
			p.link,
			p.thumbnail,
			COALESCE(p."extractedBrand", '') as brand_name
		FROM top_groups g
		CROSS JOIN LATERAL (
			SELECT * FROM "Product" pr
			WHERE pr."computedGroupId" = g.group_key
			  AND pr.price > 0
			ORDER BY pr.price ASC
			LIMIT 10
		) p
		JOIN "Vendor" v ON p."vendorId" = v.id
		ORDER BY g.vendor_count DESC, p.price ASC
	`

	rows, err := s.db.QueryContext(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Group the results
	groupMap := make(map[string]*FeaturedGroup)
	groupOrder := []string{}

	for rows.Next() {
		var (
			id, title, vendorID, vendorName, link, thumbnail, brandName, groupKey, dosageUnit, normalizedName string
			price, dosageValue, minPrice, maxPrice, avgPrice float64
			vendorCount, productCount int
		)

		err := rows.Scan(
			&groupKey, &normalizedName, &dosageValue, &dosageUnit,
			&vendorCount, &productCount, &minPrice, &maxPrice, &avgPrice,
			&id, &title, &price, &vendorID, &vendorName, &link, &thumbnail, &brandName,
		)
		if err != nil {
			continue
		}

		if _, exists := groupMap[groupKey]; !exists {
			groupMap[groupKey] = &FeaturedGroup{
				ID:             groupKey,
				NormalizedName: normalizedName,
				DosageValue:    dosageValue,
				DosageUnit:     dosageUnit,
				VendorCount:    vendorCount,
				ProductCount:   productCount,
				Products:       []FeaturedProduct{},
			}
			groupMap[groupKey].PriceRange.Min = minPrice
			groupMap[groupKey].PriceRange.Max = maxPrice
			groupMap[groupKey].PriceRange.Avg = avgPrice
			groupOrder = append(groupOrder, groupKey)
		}

		groupMap[groupKey].Products = append(groupMap[groupKey].Products, FeaturedProduct{
			ID:          id,
			Title:       title,
			Price:       price,
			VendorID:    vendorID,
			VendorName:  vendorName,
			Link:        link,
			Thumbnail:   thumbnail,
			BrandName:   brandName,
			GroupKey:    groupKey,
			DosageValue: dosageValue,
			DosageUnit:  dosageUnit,
		})
	}

	// Convert to slice and limit
	var groups []FeaturedGroup
	for _, key := range groupOrder {
		if len(groups) >= limit {
			break
		}
		groups = append(groups, *groupMap[key])
	}

	// Sort by vendor count
	sort.Slice(groups, func(i, j int) bool {
		return groups[i].VendorCount > groups[j].VendorCount
	})

	return groups, nil
}
