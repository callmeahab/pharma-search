package main

import (
	"context"
	"database/sql"
	"sort"

	"github.com/callmeahab/pharma-search/internal/matching"
)

// FeaturedProduct represents a product for the featured section
type FeaturedProduct struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Price       float64 `json:"price"`
	VendorID    string  `json:"vendor_id"`
	VendorName  string  `json:"vendor_name"`
	Link        string  `json:"link"`
	Thumbnail   string  `json:"thumbnail"`
	BrandName   string  `json:"brand_name"`
	GroupKey    string  `json:"group_key"`
	DosageValue float64 `json:"dosage_value"`
	DosageUnit  string  `json:"dosage_unit"`
	Rank        int     `json:"rank"`
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
	VendorCount  int `json:"vendor_count"`
	ProductCount int `json:"product_count"`
}

func dedupeFeaturedProductsByVendor(products []FeaturedProduct) ([]FeaturedProduct, int) {
	if len(products) <= 1 {
		return products, 0
	}

	byVendor := make(map[string]FeaturedProduct, len(products))
	for _, product := range products {
		existing, ok := byVendor[product.VendorID]
		if !ok || product.Price < existing.Price || (product.Price == existing.Price && product.ID < existing.ID) {
			byVendor[product.VendorID] = product
		}
	}

	deduped := make([]FeaturedProduct, 0, len(byVendor))
	for _, product := range byVendor {
		deduped = append(deduped, product)
	}

	sort.Slice(deduped, func(i, j int) bool {
		if deduped[i].Price != deduped[j].Price {
			return deduped[i].Price < deduped[j].Price
		}
		return deduped[i].ID < deduped[j].ID
	})

	return deduped, len(products) - len(deduped)
}

// GetFeaturedProducts returns featured products - groups with most vendors
func (s *server) GetFeaturedProducts(ctx context.Context, limit int) ([]FeaturedGroup, error) {
	// Query database for product groups with the most vendors
	// Use LATERAL join to limit products per group for performance
	query := `
		WITH top_groups AS (
			SELECT
				p."coreProductIdentity" as core_identity,
				p."dosageValue" as dosage_value,
				COALESCE(p."dosageUnit", '') as dosage_unit,
				p."volumeValue" as volume_value,
				COALESCE(p."volumeUnit", '') as volume_unit,
				p."quantityValue" as quantity_value,
				COALESCE(p.form, '') as form,
				MIN(p."normalizedName") as normalized_name,
				COUNT(DISTINCT p."vendorId") as vendor_count,
				COUNT(*) as product_count,
				MIN(p.price) as min_price,
				MAX(p.price) as max_price,
				AVG(p.price) as avg_price
			FROM "Product" p
			WHERE p."coreProductIdentity" IS NOT NULL
			  AND p."coreProductIdentity" != ''
			  AND p.price > 0
			GROUP BY
				p."coreProductIdentity",
				p."dosageValue",
				p."dosageUnit",
				p."volumeValue",
				p."volumeUnit",
				p."quantityValue",
				p.form
			HAVING COUNT(DISTINCT p."vendorId") > 1
			   AND COUNT(*) < 100
			   AND COUNT(*) / COUNT(DISTINCT p."vendorId") < 5
			ORDER BY COUNT(DISTINCT p."vendorId") DESC
			LIMIT $1
		)
		SELECT
			g.core_identity,
			g.normalized_name,
			g.dosage_value,
			g.dosage_unit,
			g.volume_value,
			g.volume_unit,
			g.quantity_value,
			g.form,
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
			WHERE pr."coreProductIdentity" = g.core_identity
			  AND (pr."dosageValue" = g.dosage_value OR (pr."dosageValue" IS NULL AND g.dosage_value IS NULL))
			  AND COALESCE(pr."dosageUnit", '') = g.dosage_unit
			  AND (pr."volumeValue" = g.volume_value OR (pr."volumeValue" IS NULL AND g.volume_value IS NULL))
			  AND COALESCE(pr."volumeUnit", '') = g.volume_unit
			  AND (pr."quantityValue" = g.quantity_value OR (pr."quantityValue" IS NULL AND g.quantity_value IS NULL))
			  AND COALESCE(pr.form, '') = g.form
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
			id, title, vendorID, vendorName, link, thumbnail, brandName, coreIdentity, dosageUnit, normalizedName, volumeUnit, form string
			price, minPrice, maxPrice, avgPrice                                                                                     float64
			dosageValue, volumeValue                                                                                                sql.NullFloat64
			quantityValue                                                                                                           sql.NullInt64
			vendorCount, productCount                                                                                               int
		)

		err := rows.Scan(
			&coreIdentity, &normalizedName, &dosageValue, &dosageUnit,
			&volumeValue, &volumeUnit, &quantityValue, &form,
			&vendorCount, &productCount, &minPrice, &maxPrice, &avgPrice,
			&id, &title, &price, &vendorID, &vendorName, &link, &thumbnail, &brandName,
		)
		if err != nil {
			continue
		}

		dv, vv, qv := 0.0, 0.0, 0.0
		if dosageValue.Valid {
			dv = dosageValue.Float64
		}
		if volumeValue.Valid {
			vv = volumeValue.Float64
		}
		if quantityValue.Valid {
			qv = float64(quantityValue.Int64)
		}

		groupKey := matching.BuildComparableGroupID(coreIdentity, dv, dosageUnit, vv, volumeUnit, qv, form)
		if groupKey == "" {
			groupKey = matching.BuildGroupID(coreIdentity, dv, dosageUnit)
		}
		if groupKey == "" {
			groupKey = coreIdentity
		}

		displayName := matching.BuildDisplayName(coreIdentity, dv, dosageUnit, vv, volumeUnit, qv, form)
		if displayName == "" {
			displayName = normalizedName
		}
		if displayName == "" {
			displayName = title
		}

		if _, exists := groupMap[groupKey]; !exists {
			groupMap[groupKey] = &FeaturedGroup{
				ID:             groupKey,
				NormalizedName: displayName,
				DosageValue:    dv,
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
			DosageValue: dv,
			DosageUnit:  dosageUnit,
		})
	}

	for _, key := range groupOrder {
		group := groupMap[key]
		deduped, _ := dedupeFeaturedProductsByVendor(group.Products)
		group.Products = deduped
		group.VendorCount = len(deduped)

		if len(deduped) == 0 {
			group.PriceRange.Min = 0
			group.PriceRange.Max = 0
			group.PriceRange.Avg = 0
			continue
		}

		totalPrice := 0.0
		group.PriceRange.Min = deduped[0].Price
		group.PriceRange.Max = deduped[len(deduped)-1].Price
		for _, product := range deduped {
			totalPrice += product.Price
		}
		group.PriceRange.Avg = totalPrice / float64(len(deduped))
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
