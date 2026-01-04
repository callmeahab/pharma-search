package main

import (
	"database/sql"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// EnhancedGroupingEngine provides advanced product grouping with fuzzy matching
type EnhancedGroupingEngine struct {
	activeIngredients map[string][]string
	dosageNormalizer  *DosageNormalizer
	brandAliases      map[string]string
	db                *sql.DB // Optional database connection for standardization lookups
}

// StandardizationResult represents the result of a standardization lookup
type StandardizationResult struct {
	StandardizedTitle string
	NormalizedName    string
	DosageValue       float64
	DosageUnit        string
	VolumeValue       float64
	VolumeUnit        string
	BrandName         string
	ProductForm       string
	Confidence        float64
	Found             bool
}

// NewEnhancedGroupingEngine creates a new enhanced grouping engine
func NewEnhancedGroupingEngine() *EnhancedGroupingEngine {
	return &EnhancedGroupingEngine{
		activeIngredients: BuildActiveIngredientMap(),
		dosageNormalizer:  NewDosageNormalizer(),
		brandAliases:      BuildBrandMap(),
		db:                nil,
	}
}

// NewEnhancedGroupingEngineWithDB creates a new enhanced grouping engine with database support
func NewEnhancedGroupingEngineWithDB(db *sql.DB) *EnhancedGroupingEngine {
	return &EnhancedGroupingEngine{
		activeIngredients: BuildActiveIngredientMap(),
		dosageNormalizer:  NewDosageNormalizer(),
		brandAliases:      BuildBrandMap(),
		db:                db,
	}
}

// SetDB sets the database connection for standardization lookups
func (e *EnhancedGroupingEngine) SetDB(db *sql.DB) {
	e.db = db
}

// LookupStandardization looks up a product title in the standardization table
func (e *EnhancedGroupingEngine) LookupStandardization(title string) StandardizationResult {
	result := StandardizationResult{Found: false}

	if e.db == nil {
		return result
	}

	// Use the lookup_standardization function we created in the migration
	row := e.db.QueryRow(`
		SELECT
			standardized_title,
			normalized_name,
			dosage_value,
			dosage_unit,
			volume_value,
			volume_unit,
			brand_name,
			product_form,
			confidence
		FROM lookup_standardization($1)
	`, title)

	var (
		standardizedTitle, normalizedName sql.NullString
		dosageValue, volumeValue          sql.NullFloat64
		dosageUnit, volumeUnit            sql.NullString
		brandName, productForm            sql.NullString
		confidence                        sql.NullFloat64
	)

	err := row.Scan(
		&standardizedTitle,
		&normalizedName,
		&dosageValue,
		&dosageUnit,
		&volumeValue,
		&volumeUnit,
		&brandName,
		&productForm,
		&confidence,
	)

	if err != nil {
		// No match found or error - return empty result
		return result
	}

	// Check if we got actual data
	if !standardizedTitle.Valid || standardizedTitle.String == "" {
		return result
	}

	result.Found = true
	result.StandardizedTitle = standardizedTitle.String
	result.NormalizedName = normalizedName.String
	result.DosageValue = dosageValue.Float64
	result.DosageUnit = dosageUnit.String
	result.VolumeValue = volumeValue.Float64
	result.VolumeUnit = volumeUnit.String
	result.BrandName = brandName.String
	result.ProductForm = productForm.String
	result.Confidence = confidence.Float64

	return result
}

// ExtractSignatureWithDB extracts a product signature, using DB lookup first then falling back to rules
func (e *EnhancedGroupingEngine) ExtractSignatureWithDB(title string) (ProductSignature, StandardizationResult) {
	// Try database lookup first
	stdResult := e.LookupStandardization(title)

	if stdResult.Found {
		// Use standardization data
		signature := ProductSignature{
			CoreIngredient: stdResult.NormalizedName,
			DosageAmount:   stdResult.DosageValue,
			DosageUnit:     stdResult.DosageUnit,
			Form:           stdResult.ProductForm,
			Quantity:       0, // Not extracted from standardization yet
		}

		// If we don't have a good normalized name, extract from standardized title
		if signature.CoreIngredient == "" {
			signature.CoreIngredient = e.extractCoreIngredient(strings.ToLower(stdResult.StandardizedTitle))
		}

		return signature, stdResult
	}

	// Fall back to rule-based extraction
	signature := e.ExtractSignature(title)
	return signature, stdResult
}

// ProductSignature represents a normalized product signature for grouping
type ProductSignature struct {
	CoreIngredient string  // Main active ingredient
	DosageAmount   float64 // Normalized dosage
	DosageUnit     string  // Normalized unit (mg, iu, g, etc)
	Form           string  // tablet, capsule, liquid, etc
	Quantity       int     // Number of units (optional)
}

// GroupKey generates a unique group key for price comparison
func (e *EnhancedGroupingEngine) GroupKey(signature ProductSignature) string {
	parts := []string{signature.CoreIngredient}

	if signature.DosageAmount > 0 {
		// Use dosage ranges for better grouping
		dosageRange := e.dosageNormalizer.GetDosageRange(
			signature.CoreIngredient,
			signature.DosageAmount,
			signature.DosageUnit,
		)
		parts = append(parts, dosageRange)
	}

	// Only include form for products where it matters (liquid vs solid)
	if signature.Form != "" && e.formMatters(signature.CoreIngredient) {
		parts = append(parts, e.normalizeForm(signature.Form))
	}

	return strings.Join(parts, "_")
}

// ExtractSignature extracts a product signature from the title
func (e *EnhancedGroupingEngine) ExtractSignature(title string) ProductSignature {
	titleLower := strings.ToLower(title)

	signature := ProductSignature{}

	// 1. Extract core ingredient (most important!)
	signature.CoreIngredient = e.extractCoreIngredient(titleLower)

	// 2. Extract dosage
	signature.DosageAmount, signature.DosageUnit = e.dosageNormalizer.ExtractDosage(titleLower)

	// 3. Extract form
	signature.Form = e.extractForm(titleLower)

	// 4. Extract quantity (optional)
	signature.Quantity = e.extractQuantity(titleLower)

	return signature
}

// extractCoreIngredient identifies the main active ingredient
func (e *EnhancedGroupingEngine) extractCoreIngredient(title string) string {
	// Find the ingredient that appears EARLIEST in the title
	// This prioritizes the main ingredient over secondary ones
	earliestPos := len(title)
	earliestIngredient := ""

	for ingredient, aliases := range e.activeIngredients {
		for _, alias := range aliases {
			pos := strings.Index(title, alias)
			if pos >= 0 && pos < earliestPos {
				earliestPos = pos
				earliestIngredient = ingredient
			}
		}
	}

	if earliestIngredient != "" {
		return earliestIngredient
	}

	// Fallback: extract first meaningful word
	words := strings.Fields(title)
	for _, word := range words {
		if len(word) > 3 && !e.isCommonWord(word) {
			return word
		}
	}

	return "unknown"
}

// extractForm extracts the product form
func (e *EnhancedGroupingEngine) extractForm(title string) string {
	formMappings := BuildFormMap()

	// Group forms into categories
	formCategories := map[string]string{
		"tablet": "oral-solid",
		"capsule": "oral-solid",
		"softgel": "oral-solid",
		"effervescent": "oral-effervescent",

		"powder": "powder",
		"sachet": "powder",

		"cream": "topical",
		"gel": "topical-gel",
		"lotion": "topical",
		"ointment": "topical",
		"balm": "topical",

		"drops": "liquid",
		"syrup": "liquid",
		"spray": "spray",

		"serum": "serum",
		"mask": "mask",
		"shampoo": "haircare",
		"soap": "soap",
	}

	// Find form in title
	for pattern, normalizedForm := range formMappings {
		if strings.Contains(title, pattern) {
			// Return categorized form
			if category, ok := formCategories[normalizedForm]; ok {
				return category
			}
			return normalizedForm
		}
	}

	return ""
}

// extractQuantity extracts the number of units
func (e *EnhancedGroupingEngine) extractQuantity(title string) int {
	patterns := []*regexp.Regexp{
		regexp.MustCompile(`(\d+)\s*(?:kom|pcs?|pieces?|tableta|kapsula|caps?)`),
		regexp.MustCompile(`\bx\s*(\d+)\b`),
		regexp.MustCompile(`(\d+)x\b`),
	}

	for _, pattern := range patterns {
		if matches := pattern.FindStringSubmatch(title); len(matches) > 1 {
			if qty, err := strconv.Atoi(matches[1]); err == nil {
				return qty
			}
		}
	}

	return 0
}

// formMatters determines if form is important for grouping this product type
func (e *EnhancedGroupingEngine) formMatters(ingredient string) bool {
	// For most supplements, tablet vs capsule doesn't matter for price comparison
	// But for topicals, liquids, etc. it does matter
	oralSupplements := []string{
		"vitamin", "mineral", "omega", "protein", "calcium",
		"magnesium", "zinc", "iron", "selenium",
	}

	for _, supp := range oralSupplements {
		if strings.Contains(ingredient, supp) {
			return false // Form doesn't matter
		}
	}

	return true // Form matters
}

// normalizeForm groups similar forms together
func (e *EnhancedGroupingEngine) normalizeForm(form string) string {
	if form == "tablet" || form == "capsule" {
		return "oral-solid"
	}
	return form
}

// isCommonWord checks if a word is too common to be meaningful
func (e *EnhancedGroupingEngine) isCommonWord(word string) bool {
	common := []string{
		"with", "plus", "extra", "super", "mega", "ultra",
		"for", "and", "or", "the", "a", "an",
	}

	for _, c := range common {
		if word == c {
			return true
		}
	}

	return false
}

// DosageNormalizer handles dosage normalization and ranging
type DosageNormalizer struct {
	unitConversions map[string]float64
}

func NewDosageNormalizer() *DosageNormalizer {
	// Build conversion map
	conversions := map[string]float64{
		// Weight conversions to mg
		"mg":  1.0,
		"g":   1000.0,
		"mcg": 0.001,
		"kg":  1000000.0,

		// IU stays as IU (International Units - no conversion)
		"iu": 1.0,

		// Volume (no conversion)
		"ml": 1.0,
		"l": 1000.0,
	}

	return &DosageNormalizer{
		unitConversions: conversions,
	}
}

// ExtractDosage extracts and normalizes dosage from title
func (d *DosageNormalizer) ExtractDosage(title string) (float64, string) {
	titleLower := strings.ToLower(title)

	// Pattern to match dosage with unit
	pattern := regexp.MustCompile(`(\d+(?:[.,]\d+)?)\s*(mg|g|gr|mcg|μg|iu|ie|i\.j\.|ij)\b`)

	matches := pattern.FindStringSubmatch(titleLower)
	if len(matches) >= 3 {
		// Extract value
		valueStr := strings.ReplaceAll(matches[1], ",", ".")
		value, err := strconv.ParseFloat(valueStr, 64)
		if err != nil {
			return 0, ""
		}

		// Extract and normalize unit
		unit := d.normalizeUnit(matches[2])

		// Normalize to standard units
		normalizedValue, normalizedUnit := d.normalize(value, unit)
		return normalizedValue, normalizedUnit
	}

	return 0, ""
}

// normalizeUnit standardizes unit naming
func (d *DosageNormalizer) normalizeUnit(unit string) string {
	unitMap := BuildDosageUnitMap()

	if normalized, ok := unitMap[unit]; ok {
		return normalized
	}
	return unit
}

// normalize converts dosage to standard units (mg or iu)
func (d *DosageNormalizer) normalize(value float64, unit string) (float64, string) {
	// IU units stay as IU
	if unit == "iu" {
		return value, "iu"
	}

	// Convert everything else to mg
	if conversion, ok := d.unitConversions[unit]; ok {
		return value * conversion, "mg"
	}

	return value, unit
}

// GetDosageRange categorizes dosage into ranges for grouping
func (d *DosageNormalizer) GetDosageRange(ingredient string, value float64, unit string) string {
	if value == 0 {
		return "any"
	}

	// Normalize first
	normalizedValue, normalizedUnit := d.normalize(value, unit)

	// Product-specific ranges
	if strings.Contains(ingredient, "vitamin_d") && normalizedUnit == "iu" {
		if normalizedValue <= 1000 {
			return "low-iu"
		} else if normalizedValue <= 2500 {
			return "standard-iu"
		} else if normalizedValue <= 5000 {
			return "high-iu"
		} else {
			return "ultra-iu"
		}
	}

	if strings.Contains(ingredient, "vitamin_c") && normalizedUnit == "mg" {
		if normalizedValue <= 500 {
			return "low-mg"
		} else if normalizedValue <= 1000 {
			return "standard-mg"
		} else if normalizedValue <= 2000 {
			return "high-mg"
		} else {
			return "ultra-mg"
		}
	}

	if strings.Contains(ingredient, "omega") && normalizedUnit == "mg" {
		if normalizedValue <= 500 {
			return "low-mg"
		} else if normalizedValue <= 1000 {
			return "standard-mg"
		} else if normalizedValue <= 2000 {
			return "high-mg"
		} else {
			return "ultra-mg"
		}
	}

	// Default ranges
	if normalizedUnit == "mg" {
		if normalizedValue <= 100 {
			return "low-mg"
		} else if normalizedValue <= 500 {
			return "standard-mg"
		} else if normalizedValue <= 1500 {
			return "high-mg"
		} else {
			return "ultra-mg"
		}
	}

	if normalizedUnit == "iu" {
		if normalizedValue <= 500 {
			return "low-iu"
		} else if normalizedValue <= 2000 {
			return "standard-iu"
		} else if normalizedValue <= 5000 {
			return "high-iu"
		} else {
			return "ultra-iu"
		}
	}

	return fmt.Sprintf("%.0f-%s", normalizedValue, normalizedUnit)
}
