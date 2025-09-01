package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"

	meilisearch "github.com/meilisearch/meilisearch-go"
)

// ProductProcessor handles product processing and normalization
type ProductProcessor struct {
	db         *sql.DB
	normalizer *PharmaNormalizer
}

// ProductRow represents a product row from database
type ProductRow struct {
	ID    string
	Title string
	Price float64
}

// ProcessingStats represents processing statistics
type ProcessingStats struct {
	TotalProducts      int `json:"totalProducts"`
	ProcessedProducts  int `json:"processedProducts"`
	NormalizedProducts int `json:"normalizedProducts"`
	TokenizedProducts  int `json:"tokenizedProducts"`
	VectorizedProducts int `json:"vectorizedProducts"`
}

// NewProductProcessor creates a new product processor
func NewProductProcessor(db *sql.DB) *ProductProcessor {
	return &ProductProcessor{
		db:         db,
		normalizer: NewPharmaNormalizer(),
	}
}

// ProcessProducts processes all unprocessed products
func (p *ProductProcessor) ProcessProducts(ctx context.Context, batchSize int) error {
	log.Println("Starting product processing (normalization only)")

	totalCount, err := p.getUnprocessedCount(ctx)
	if err != nil {
		return fmt.Errorf("failed to get unprocessed count: %w", err)
	}

	log.Printf("Found %d unprocessed products", totalCount)

	processed := 0
	for processed < totalCount {
		products, err := p.fetchUnprocessedBatch(ctx, batchSize)
		if err != nil {
			return fmt.Errorf("failed to fetch batch: %w", err)
		}

		if len(products) == 0 {
			break
		}

		processedProducts := p.processBatchNormalized(products)
		if err := p.saveProcessedProducts(ctx, processedProducts); err != nil {
			return fmt.Errorf("failed to save processed products: %w", err)
		}

		processed += len(products)
		log.Printf("Processed %d/%d products (%.1f%%)", processed, totalCount, float64(processed)/float64(totalCount)*100)
	}

	log.Printf("Processed %d products with normalization", processed)
	return nil
}

// ReprocessAllProducts reprocesses all products
func (p *ProductProcessor) ReprocessAllProducts(ctx context.Context) error {
	log.Println("Reprocessing all products")

	// Reset all products to unprocessed
	_, err := p.db.ExecContext(ctx, `
		UPDATE "Product" 
		SET 
			"processedAt" = NULL,
			"normalizedName" = NULL,
			"searchTokens" = NULL,
			"searchVector" = NULL,
			"extractedBrand" = NULL,
			"productLine" = NULL,
			"dosageValue" = NULL,
			"dosageUnit" = NULL,
			"volumeValue" = NULL,
			"volumeUnit" = NULL,
			"form" = NULL,
			"spfValue" = NULL,
			"coreProductIdentity" = NULL
	`)
	if err != nil {
		return fmt.Errorf("failed to reset products: %w", err)
	}

	// Process all products
	return p.ProcessProducts(ctx, 10000)
}

// processBatchNormalized processes a batch of products with normalization
func (p *ProductProcessor) processBatchNormalized(products []ProductRow) []ProcessedProductData {
	var processed []ProcessedProductData

	for _, product := range products {
		// Normalize the product
		normalized := p.normalizer.Normalize(product.Title)

		// Create processed product data
		// Clean and limit search tokens
		cleanTokens := make([]string, 0, len(normalized.SearchTokens))
		for _, token := range normalized.SearchTokens {
			if len(token) >= 3 && len(token) <= 50 {
				// Clean token of problematic characters
				clean := strings.ReplaceAll(token, `"`, "")
				clean = strings.ReplaceAll(clean, `'`, "")
				clean = strings.ReplaceAll(clean, `\`, "")
				if clean != "" {
					cleanTokens = append(cleanTokens, clean)
				}
			}
		}
		
		// Limit to 20 tokens max
		if len(cleanTokens) > 20 {
			cleanTokens = cleanTokens[:20]
		}

		processedProduct := ProcessedProductData{
			ID:                  product.ID,
			Title:               product.Title,
			Price:               product.Price,
			NormalizedName:      normalized.NormalizedName,
			SearchTokens:        strings.Join(cleanTokens, " "),
			SearchVector:        normalized.NormalizedName,
			ExtractedBrand:      normalized.Attributes.Brand,
			ProductLine:         normalized.Attributes.ProductName,
			DosageValue:         normalized.Attributes.DosageValue,
			DosageUnit:          normalized.Attributes.DosageUnit,
			VolumeValue:         normalized.Attributes.VolumeValue,
			VolumeUnit:          normalized.Attributes.VolumeUnit,
			Form:                normalized.Attributes.Form,
			SPFValue:            int(normalized.Attributes.SPFValue), // Convert float to int
			CoreProductIdentity: normalized.CoreIdentity,
			ProcessedAt:         time.Now(),
		}

		processed = append(processed, processedProduct)
	}

	return processed
}

// ProcessedProductData represents processed product data for database update
type ProcessedProductData struct {
	ID                  string
	Title               string
	Price               float64
	NormalizedName      string
	SearchTokens        string
	SearchVector        string
	ExtractedBrand      string
	ProductLine         string
	DosageValue         float64
	DosageUnit          string
	VolumeValue         float64
	VolumeUnit          string
	Form                string
	SPFValue            int
	CoreProductIdentity string
	ProcessedAt         time.Time
}

// saveProcessedProducts saves processed products to database
func (p *ProductProcessor) saveProcessedProducts(ctx context.Context, products []ProcessedProductData) error {
	if len(products) == 0 {
		return nil
	}

	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `
		UPDATE "Product" 
		SET 
			"normalizedName" = $2,
			"searchTokens" = string_to_array($3, ' '),
			"searchVector" = to_tsvector('english', $4),
			"extractedBrand" = NULLIF($5, ''),
			"productLine" = NULLIF($6, ''),
			"dosageValue" = NULLIF($7, 0),
			"dosageUnit" = NULLIF($8, ''),
			"volumeValue" = NULLIF($9, 0),
			"volumeUnit" = NULLIF($10, ''),
			"form" = NULLIF($11, ''),
			"spfValue" = NULLIF($12, 0),
			"coreProductIdentity" = NULLIF($13, ''),
			"processedAt" = $14
		WHERE id = $1
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	for _, product := range products {
		_, err := stmt.ExecContext(ctx,
			product.ID,
			product.NormalizedName,
			product.SearchTokens,
			product.SearchVector,
			product.ExtractedBrand,
			product.ProductLine,
			product.DosageValue,
			product.DosageUnit,
			product.VolumeValue,
			product.VolumeUnit,
			product.Form,
			product.SPFValue,
			product.CoreProductIdentity,
			product.ProcessedAt,
		)
		if err != nil {
			log.Printf("Error saving product %s: %v", product.ID, err)
			continue
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// getUnprocessedCount gets count of unprocessed products
func (p *ProductProcessor) getUnprocessedCount(ctx context.Context) (int, error) {
	var count int
	err := p.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM "Product" WHERE "processedAt" IS NULL`).Scan(&count)
	return count, err
}

// fetchUnprocessedBatch fetches a batch of unprocessed products
func (p *ProductProcessor) fetchUnprocessedBatch(ctx context.Context, batchSize int) ([]ProductRow, error) {
	rows, err := p.db.QueryContext(ctx, `
		SELECT id, title, price
		FROM "Product" 
		WHERE "processedAt" IS NULL
		LIMIT $1
	`, batchSize)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var products []ProductRow
	for rows.Next() {
		var product ProductRow
		if err := rows.Scan(&product.ID, &product.Title, &product.Price); err != nil {
			log.Printf("Error scanning product row: %v", err)
			continue
		}
		products = append(products, product)
	}

	return products, rows.Err()
}

// AnalyzeProcessingEffectiveness analyzes processing effectiveness
func (p *ProductProcessor) AnalyzeProcessingEffectiveness(ctx context.Context) (ProcessingStats, error) {
	var stats ProcessingStats

	err := p.db.QueryRowContext(ctx, `
		SELECT 
			COUNT(*) as total_products,
			COUNT("processedAt") as processed_products,
			COUNT("normalizedName") as normalized_products,
			COUNT("searchTokens") as tokenized_products,
			COUNT("searchVector") as vectorized_products
		FROM "Product"
	`).Scan(
		&stats.TotalProducts,
		&stats.ProcessedProducts,
		&stats.NormalizedProducts,
		&stats.TokenizedProducts,
		&stats.VectorizedProducts,
	)
	if err != nil {
		return stats, fmt.Errorf("failed to get processing stats: %w", err)
	}

	log.Printf("Processing Statistics:")
	log.Printf("  Total products: %d", stats.TotalProducts)
	log.Printf("  Processed: %d", stats.ProcessedProducts)
	log.Printf("  Normalized: %d", stats.NormalizedProducts)
	log.Printf("  Tokenized: %d", stats.TokenizedProducts)
	log.Printf("  Vectorized: %d", stats.VectorizedProducts)

	return stats, nil
}

// GroupingStats represents grouping effectiveness statistics
type GroupingStats struct {
	TotalProducts         int     `json:"totalProducts"`
	ProcessedProducts     int     `json:"processedProducts"`
	ValidNormalized      int     `json:"validNormalized"`
	UniqueGroups         int     `json:"uniqueGroups"`
	UniqueVendors        int     `json:"uniqueVendors"`
	AvgProductsPerGroup  float64 `json:"avgProductsPerGroup"`
	MaxProductsPerGroup  int     `json:"maxProductsPerGroup"`
	AvgVendorsPerGroup   float64 `json:"avgVendorsPerGroup"`
	MaxVendorsPerGroup   int     `json:"maxVendorsPerGroup"`
	GroupsWithMultiVendors int   `json:"groupsWithMultiVendors"`
}

// AnalyzeGroupingEffectiveness analyzes grouping effectiveness for price comparison
func (p *ProductProcessor) AnalyzeGroupingEffectiveness(ctx context.Context) (GroupingStats, error) {
	var stats GroupingStats

	// Get basic processing stats
	err := p.db.QueryRowContext(ctx, `
		SELECT 
			COUNT(*) as total_products,
			COUNT("processedAt") as processed_products,
			COUNT(CASE WHEN "normalizedName" IS NOT NULL AND "normalizedName" != '' THEN 1 END) as valid_normalized
		FROM "Product"
	`).Scan(&stats.TotalProducts, &stats.ProcessedProducts, &stats.ValidNormalized)
	if err != nil {
		return stats, fmt.Errorf("failed to get basic stats: %w", err)
	}

	// Get grouping effectiveness stats
	err = p.db.QueryRowContext(ctx, `
		SELECT 
			COUNT(DISTINCT "normalizedName") as unique_groups,
			(SELECT COUNT(DISTINCT "vendorId") FROM "Product") as unique_vendors,
			COALESCE(ROUND(AVG(product_count), 2), 0) as avg_products_per_group,
			COALESCE(MAX(product_count), 0) as max_products_per_group
		FROM (
			SELECT 
				"normalizedName",
				COUNT(*) as product_count
			FROM "Product" 
			WHERE "normalizedName" IS NOT NULL 
			AND "normalizedName" != ''
			GROUP BY "normalizedName"
		) groups
	`).Scan(&stats.UniqueGroups, &stats.UniqueVendors, &stats.AvgProductsPerGroup, &stats.MaxProductsPerGroup)
	if err != nil {
		return stats, fmt.Errorf("failed to get grouping stats: %w", err)
	}

	// Get vendor distribution
	err = p.db.QueryRowContext(ctx, `
		SELECT 
			COALESCE(ROUND(AVG(vendor_count), 2), 0) as avg_vendors_per_group,
			COALESCE(MAX(vendor_count), 0) as max_vendors_per_group,
			COUNT(CASE WHEN vendor_count > 1 THEN 1 END) as groups_with_multiple_vendors
		FROM (
			SELECT 
				"normalizedName",
				COUNT(DISTINCT "vendorId") as vendor_count
			FROM "Product" 
			WHERE "normalizedName" IS NOT NULL 
			AND "normalizedName" != ''
			GROUP BY "normalizedName"
		) vendor_groups
	`).Scan(&stats.AvgVendorsPerGroup, &stats.MaxVendorsPerGroup, &stats.GroupsWithMultiVendors)
	if err != nil {
		return stats, fmt.Errorf("failed to get vendor stats: %w", err)
	}

	log.Println("🔍 Grouping Effectiveness Analysis:")
	log.Println(strings.Repeat("=", 50))
	log.Println("📊 Processing Overview:")
	log.Printf("  • Total products: %d", stats.TotalProducts)
	log.Printf("  • Processed products: %d", stats.ProcessedProducts)
	log.Printf("  • Valid normalized names: %d", stats.ValidNormalized)
	
	log.Println("\n🎯 Grouping Statistics:")
	log.Printf("  • Unique product groups: %d", stats.UniqueGroups)
	log.Printf("  • Average products per group: %.2f", stats.AvgProductsPerGroup)
	log.Printf("  • Largest group size: %d", stats.MaxProductsPerGroup)
	
	log.Println("\n🏪 Vendor Distribution:")
	log.Printf("  • Total unique vendors: %d", stats.UniqueVendors)
	log.Printf("  • Average vendors per group: %.2f", stats.AvgVendorsPerGroup)
	log.Printf("  • Max vendors per group: %d", stats.MaxVendorsPerGroup)
	log.Printf("  • Groups with multiple vendors: %d", stats.GroupsWithMultiVendors)
	
	// Calculate price comparison potential
	if stats.GroupsWithMultiVendors > 0 && stats.UniqueGroups > 0 {
		comparisonRate := float64(stats.GroupsWithMultiVendors) / float64(stats.UniqueGroups) * 100
		log.Println("\n💰 Price Comparison Potential:")
		log.Printf("  • Groups enabling price comparison: %.1f%%", comparisonRate)
	}

	return stats, nil
}

// IndexToMeilisearch indexes products to Meilisearch
func (p *ProductProcessor) IndexToMeilisearch(ctx context.Context, meiliURL string, batchSize int) error {
	log.Println("📊 Starting product indexing to Meilisearch...")

	client := meilisearch.New(meiliURL, meilisearch.WithAPIKey(""))

	index := client.Index("products")

	// Configure index settings
	if err := p.setupMeilisearchIndex(ctx, index); err != nil {
		return fmt.Errorf("failed to setup meilisearch index: %w", err)
	}

	// Get total count
	var total int
	err := p.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM "Product"`).Scan(&total)
	if err != nil {
		return fmt.Errorf("failed to get total count: %w", err)
	}

	log.Printf("📈 Total products to index: %d", total)

	processed := 0
	offset := 0

	for offset < total {
		// Fetch batch
		rows, err := p.db.QueryContext(ctx, `
			SELECT 
				p.id, p.title, p.price, p.link, p.thumbnail,
				p."extractedBrand", p."productLine", p."volumeValue", p."volumeUnit",
				p."dosageValue", p."dosageUnit", p."form", p."spfValue",
				p."computedGroupId", p."groupingMethod",
				v.name as vendor_name, v.id as vendor_id,
				b.name as brand_name
			FROM "Product" p
			JOIN "Vendor" v ON v.id = p."vendorId"
			LEFT JOIN "Brand" b ON b.id = p."brandId"
			ORDER BY p.id
			LIMIT $1 OFFSET $2
		`, batchSize, offset)
		if err != nil {
			return fmt.Errorf("failed to fetch batch: %w", err)
		}

		var documents []map[string]interface{}
		for rows.Next() {
			var (
				id, title, link, thumbnail, extractedBrand, productLine                         sql.NullString
				volumeUnit, dosageUnit, form, computedGroupId, groupingMethod                   sql.NullString
				vendorName, vendorID, brandName                                                 sql.NullString
				price, volumeValue, dosageValue                                                 sql.NullFloat64
				spfValue                                                                        sql.NullInt64
			)

			err := rows.Scan(
				&id, &title, &price, &link, &thumbnail,
				&extractedBrand, &productLine, &volumeValue, &volumeUnit,
				&dosageValue, &dosageUnit, &form, &spfValue,
				&computedGroupId, &groupingMethod,
				&vendorName, &vendorID, &brandName,
			)
			if err != nil {
				log.Printf("Error scanning row: %v", err)
				continue
			}

			// Transform to Meilisearch document
			doc := p.transformToMeiliDocument(MeiliTransformData{
				ID:              id.String,
				Title:           title.String,
				Price:           price.Float64,
				Link:            link.String,
				Thumbnail:       thumbnail.String,
				ExtractedBrand:  extractedBrand.String,
				ProductLine:     productLine.String,
				VolumeValue:     volumeValue.Float64,
				VolumeUnit:      volumeUnit.String,
				DosageValue:     dosageValue.Float64,
				DosageUnit:      dosageUnit.String,
				Form:            form.String,
				SPFValue:        int(spfValue.Int64),
				ComputedGroupID: computedGroupId.String,
				GroupingMethod:  groupingMethod.String,
				VendorName:      vendorName.String,
				VendorID:        vendorID.String,
				BrandName:       brandName.String,
			})

			documents = append(documents, doc)
		}
		rows.Close()

		if len(documents) == 0 {
			break
		}

		// Index batch to Meilisearch
		_, err = index.AddDocuments(documents, nil)
		if err != nil {
			log.Printf("❌ Failed to index batch: %v", err)
			break
		}

		processed += len(documents)
		log.Printf("✅ Indexed batch: %d/%d (%.1f%%)", processed, total, float64(processed)/float64(total)*100)

		offset += batchSize
	}

	log.Printf("🎉 Indexing completed! %d products indexed to Meilisearch", processed)
	return nil
}

// MeiliTransformData represents data for Meilisearch transformation
type MeiliTransformData struct {
	ID              string
	Title           string
	Price           float64
	Link            string
	Thumbnail       string
	ExtractedBrand  string
	ProductLine     string
	VolumeValue     float64
	VolumeUnit      string
	DosageValue     float64
	DosageUnit      string
	Form            string
	SPFValue        int
	ComputedGroupID string
	GroupingMethod  string
	VendorName      string
	VendorID        string
	BrandName       string
}

// transformToMeiliDocument transforms product data to Meilisearch document
func (p *ProductProcessor) transformToMeiliDocument(data MeiliTransformData) map[string]interface{} {
	// Extract simple attributes from title
	normalized := p.normalizer.Normalize(data.Title)
	
	// Use extracted brand or fallback to normalized
	brand := data.ExtractedBrand
	if brand == "" && normalized.Attributes.Brand != "" {
		brand = normalized.Attributes.Brand
	}

	// Determine category
	category := p.categorizeProduct(data.Title)
	
	// Create searchable text
	searchableText := p.createSearchableText(data.Title, brand, category)

	doc := map[string]interface{}{
		"id":              fmt.Sprintf("product_%s", data.ID),
		"title":           data.Title,
		"normalizedTitle": strings.ToLower(data.Title),
		"price":           int(data.Price * 100), // Convert to cents
		"category":        category,
		"link":            data.Link,
		"thumbnail":       data.Thumbnail,
		"vendorId":        data.VendorID,
		"vendorName":      data.VendorName,
		"searchableText":  searchableText,
		"brand":           brand,
		"productLine":     data.ProductLine,
		"brandFacet":      brand,
		"categoryFacet":   category,
		"inStock":         true,
	}

	// Add form if available
	form := data.Form
	if form == "" && normalized.Attributes.Form != "" {
		form = normalized.Attributes.Form
	}
	if form != "" {
		doc["formFacet"] = form
	}

	// Add dosage info
	if data.DosageValue > 0 || normalized.Attributes.DosageValue > 0 {
		dosageVal := data.DosageValue
		dosageUnit := data.DosageUnit
		if dosageVal == 0 {
			dosageVal = normalized.Attributes.DosageValue
			dosageUnit = normalized.Attributes.DosageUnit
		}
		if dosageVal > 0 {
			doc["dosageValue"] = dosageVal
			doc["dosageUnit"] = dosageUnit
		}
	}

	// Add volume info
	if data.VolumeValue > 0 || normalized.Attributes.VolumeValue > 0 {
		volVal := data.VolumeValue
		volUnit := data.VolumeUnit
		if volVal == 0 {
			volVal = normalized.Attributes.VolumeValue
			volUnit = normalized.Attributes.VolumeUnit
		}
		if volVal > 0 {
			doc["volumeValue"] = volVal
			doc["volumeUnit"] = volUnit
			doc["volumeRange"] = p.getVolumeRange(volVal)
		}
	}

	// Add SPF info
	spfVal := data.SPFValue
	if spfVal == 0 {
		spfVal = normalized.Attributes.SPFValue
	}
	if spfVal > 0 {
		doc["spfValue"] = spfVal
		doc["spfRange"] = p.getSPFRange(spfVal)
	}

	// Add price range
	doc["priceRange"] = p.getPriceRange(int(data.Price * 100))

	// Add quantity if available
	if normalized.Attributes.Quantity > 0 {
		doc["dosageCount"] = normalized.Attributes.Quantity
	}

	// Add grouping info if available
	if data.ComputedGroupID != "" {
		doc["computedGroupId"] = data.ComputedGroupID
		doc["groupingMethod"] = data.GroupingMethod
	}

	return doc
}

// Helper functions for Meilisearch indexing

func (p *ProductProcessor) categorizeProduct(title string) string {
	titleLower := strings.ToLower(title)
	
	categoryMappings := map[string]string{
		"krema|cream|losion|lotion|mleko|gel": "skincare",
		"spray|sprej":                         "spray", 
		"tablet|tablete|kapsul|capsule":       "oral",
		"drops|kapi":                          "drops",
		"šampon|shampoo":                      "haircare",
		"sun|spf":                             "suncare",
		"vitamin":                             "supplements",
		"protein|whey":                        "sports",
		"sapun|soap":                          "hygiene",
	}

	for pattern, category := range categoryMappings {
		if strings.Contains(titleLower, pattern) {
			return category
		}
	}
	return "other"
}

func (p *ProductProcessor) createSearchableText(title, brand, category string) string {
	texts := []string{strings.ToLower(title)}
	
	if brand != "" {
		texts = append(texts, strings.ToLower(brand))
	}
	if category != "" {
		texts = append(texts, category)
	}

	// Add synonyms for common terms
	titleLower := strings.ToLower(title)
	if strings.Contains(titleLower, "vitamin d") {
		texts = append(texts, "cholecalciferol", "vitamin d3")
	}
	if strings.Contains(titleLower, "omega 3") {
		texts = append(texts, "fish oil", "dha", "epa")
	}
	if strings.Contains(titleLower, "spf") {
		texts = append(texts, "sunscreen", "sun protection")
	}

	return strings.Join(texts, " ")
}

func (p *ProductProcessor) getVolumeRange(volume float64) string {
	if volume <= 30 {
		return "mini"
	} else if volume <= 100 {
		return "small"
	} else if volume <= 300 {
		return "medium"
	} else if volume <= 500 {
		return "large"
	} else {
		return "xl"
	}
}

func (p *ProductProcessor) getPriceRange(price int) string {
	if price <= 1000 {
		return "budget"
	} else if price <= 3000 {
		return "affordable"
	} else if price <= 6000 {
		return "premium"
	} else {
		return "luxury"
	}
}

func (p *ProductProcessor) getSPFRange(spf int) string {
	if spf <= 15 {
		return "low"
	} else if spf <= 30 {
		return "medium"
	} else if spf <= 50 {
		return "high"
	} else {
		return "very_high"
	}
}

func (p *ProductProcessor) setupMeilisearchIndex(ctx context.Context, index meilisearch.IndexManager) error {
	// Configure searchable attributes
	searchableConfig := []string{
		"title",
		"brand", 
		"productLine",
		"searchableText",
		"genericName",
		"tags",
	}

	_, err := index.UpdateSearchableAttributes(&searchableConfig)
	if err != nil {
		return fmt.Errorf("failed to update searchable attributes: %w", err)
	}

	// Configure filterable attributes
	filterableConfig := []string{
		"brandFacet",
		"categoryFacet",
		"formFacet",
		"volumeRange",
		"priceRange",
		"spfRange",
		"prescriptionRequired",
		"inStock",
		"price",
	}

	// Convert to interface{} slice for meilisearch
	filterableInterface := make([]interface{}, len(filterableConfig))
	for i, v := range filterableConfig {
		filterableInterface[i] = v
	}
	_, err = index.UpdateFilterableAttributes(&filterableInterface)
	if err != nil {
		return fmt.Errorf("failed to update filterable attributes: %w", err)
	}

	// Configure sortable attributes
	sortableConfig := []string{"price", "title", "brand"}

	_, err = index.UpdateSortableAttributes(&sortableConfig)
	if err != nil {
		return fmt.Errorf("failed to update sortable attributes: %w", err)
	}

	// Configure synonyms
	synonymsConfig := map[string][]string{
		"acetaminophen": {"paracetamol", "tylenol"},
		"ibuprofen":     {"advil", "brufen", "nurofen"},
		"vitamin_d":     {"vitamin_d3", "cholecalciferol"},
		"omega_3":       {"omega3", "fish_oil", "dha", "epa"},
		"spf":           {"sun_protection_factor", "sunscreen"},
		"ml":            {"milliliter", "milliliters"},
		"mg":            {"milligram", "milligrams"},
	}

	_, err = index.UpdateSynonyms(&synonymsConfig)
	if err != nil {
		return fmt.Errorf("failed to update synonyms: %w", err)
	}

	log.Println("✅ Meilisearch index configured")
	return nil
}