package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// ExtractedAttributes represents product attributes extracted from title
type ExtractedAttributes struct {
	Brand       string  `json:"brand,omitempty"`
	ProductName string  `json:"productName,omitempty"`
	DosageValue float64 `json:"dosageValue,omitempty"`
	DosageUnit  string  `json:"dosageUnit,omitempty"`
	VolumeValue float64 `json:"volumeValue,omitempty"`
	VolumeUnit  string  `json:"volumeUnit,omitempty"`
	Quantity    int     `json:"quantity,omitempty"`
	Form        string  `json:"form,omitempty"`
	SPFValue    int     `json:"spfValue,omitempty"`
}

// ProcessedProduct represents a normalized product
type ProcessedProduct struct {
	OriginalTitle    string               `json:"originalTitle"`
	NormalizedName   string               `json:"normalizedName"`
	Attributes       ExtractedAttributes  `json:"attributes"`
	SearchTokens     []string             `json:"searchTokens"`
	GroupKey         string               `json:"groupKey"`
	SimilarityKey    string               `json:"similarityKey"`
	CoreIdentity     string               `json:"coreIdentity"`
}

// PharmaNormalizer handles product normalization
type PharmaNormalizer struct {
	coreProductMappings map[string]string
	brandMappings       map[string]string
	unitMappings        map[string]string
	formMappings        map[string]string
	categoryMappings    map[string]string
	dosagePatterns      []*regexp.Regexp
	quantityPatterns    []*regexp.Regexp
	volumePatterns      []*regexp.Regexp
	removePatterns      []*regexp.Regexp
}

// NewPharmaNormalizer creates a new normalizer instance
func NewPharmaNormalizer() *PharmaNormalizer {
	n := &PharmaNormalizer{
		coreProductMappings: map[string]string{
			"vitamin d3":       "vitamin d",
			"vitamin d 3":      "vitamin d",
			"vitamin d-3":      "vitamin d",
			"d3":               "vitamin d",
			"cholecalciferol":  "vitamin d",
			"vitamin k1":       "vitamin k",
			"vitamin k 1":      "vitamin k", 
			"vitamin k-1":      "vitamin k",
			"k1":               "vitamin k",
			"d3+k1":            "vitamin d + vitamin k",
			"d3 + k1":          "vitamin d + vitamin k",
			"vitamin b12":      "vitamin b12",
			"vitamin b 12":     "vitamin b12",
			"vitamin b-12":     "vitamin b12",
			"cyanocobalamin":   "vitamin b12",
			"methylcobalamin":  "vitamin b12",
			"vitamin c":        "vitamin c",
			"ascorbic acid":    "vitamin c",
			"vitamin e":        "vitamin e",
			"tocopherol":       "vitamin e",
			"calcium carbonate": "calcium",
			"calcium citrate":  "calcium",
			"magnesium oxide":  "magnesium",
			"magnesium citrate": "magnesium",
			"zinc gluconate":   "zinc",
			"zinc picolinate":  "zinc",
			"whey protein":     "protein",
			"casein protein":   "protein",
			"plant protein":    "protein",
			"protein powder":   "protein",
			"fish oil":         "omega3",
			"omega 3":          "omega3",
			"omega-3":          "omega3",
			"epa dha":          "omega3",
			"coenzyme q10":     "coq10",
			"co q10":           "coq10",
			"co-q10":           "coq10",
			"ubiquinol":        "coq10",
			"creatine monohydrate": "creatine",
			"creatine hcl":     "creatine",
			"l-glutamine":      "glutamine",
			"l-arginine":       "arginine",
			"l-leucine":        "leucine",
			"l-carnitine":      "carnitine",
			"acetyl l-carnitine": "carnitine",
			"b complex":        "b-complex",
			"b-complex":        "b-complex",
			"vitamin b complex": "b-complex",
			"multivitamin":     "multivitamin",
			"multi vitamin":    "multivitamin",
			"bcaa":             "bcaa",
			"branched chain amino acids": "bcaa",
			"eaa":              "eaa",
			"essential amino acids": "eaa",
		},
		brandMappings: map[string]string{
			"naughty boy":   "Naughty Boy",
			"oneraw":        "OneRaw",
			"nocco":         "NOCCO",
			"maxler":        "Maxler",
			"applied":       "Applied",
			"esi":           "ESI",
			"cellzoom":      "CellZoom",
			"moonstruck":    "MoonStruck",
			"caretaker":     "CareTaker",
			"yambam":        "YamBam",
			"tigger":        "Tigger",
			"thera band":    "Thera Band",
			"la roche posay": "La Roche Posay",
			"la roche-posay": "La Roche Posay",
			"lrp":           "La Roche Posay",
			"sebamed":       "Sebamed",
			"centrum":       "Centrum",
			"babytol":       "Babytol",
		},
		unitMappings: map[string]string{
			"gr": "g", "grams": "g", "gram": "g", "kg": "kg", "kilogram": "kg",
			"mg": "mg", "miligram": "mg", "milligram": "mg", "mcg": "mcg",
			"μg": "mcg", "mikrogram": "mcg", "ml": "ml", "mililitar": "ml",
			"milliliter": "ml", "l": "L", "litar": "L", "liter": "L",
			"c": "caps", "cap": "caps", "caps": "caps", "capsule": "caps",
			"kapsule": "caps", "kapsula": "caps", "t": "tab", "tab": "tab",
			"tabs": "tab", "tablet": "tab", "tableta": "tab", "tablete": "tab",
			"gc": "softgel", "gelcaps": "softgel", "gb": "gummies",
			"gummies": "gummies", "ser": "serving", "serving": "serving",
			"iu": "IU", "ie": "IU",
		},
		formMappings: map[string]string{
			"powder": "powder", "prah": "powder", "prašak": "powder",
			"capsule": "capsule", "kapsule": "capsule", "kapsula": "capsule",
			"tablet": "tablet", "tablete": "tablet", "tableta": "tablet",
			"sirup": "syrup", "syrup": "syrup", "gel": "gel", "gela": "gel",
			"krema": "cream", "cream": "cream", "krem": "cream",
			"shot": "shot", "šot": "shot", "drink": "drink", "napitak": "drink",
			"bar": "bar", "pločica": "bar", "mast": "ointment",
			"ointment": "ointment", "kapi": "drops", "drops": "drops",
			"sprej": "spray", "spray": "spray",
		},
		categoryMappings: map[string]string{
			"krema|cream":        "skincare",
			"losion|lotion|mleko": "skincare",
			"gel":                "skincare",
			"spray|sprej":        "spray",
			"tablet|tablete":     "oral",
			"kapsul|capsule":     "oral",
			"drops|kapi":         "drops",
			"šampon|shampoo":     "haircare",
			"sun|spf":            "suncare",
			"vitamin":            "supplements",
			"protein|whey":       "sports",
			"sapun|soap":         "hygiene",
		},
	}

	// Compile regex patterns
	n.dosagePatterns = []*regexp.Regexp{
		regexp.MustCompile(`(\d+(?:[.,]\d+)?)\s*(mg|g|mcg|μg|iu|ie)\b`),
		regexp.MustCompile(`(\d+(?:[.,]\d+)?)\s*(miligram|gram|mikrogram)`),
		regexp.MustCompile(`(\d+(?:[.,]\d+)?)\s*%`),
	}

	n.quantityPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(\d+)\s*(caps?|tablets?|tab|gc|gb|t|c|ser|serving|kapsul[ea]|tablet[ea])\b`),
		regexp.MustCompile(`(\d+)(c|t|gc|gb)$`),
		regexp.MustCompile(`a(\d+)\b`),
	}

	n.volumePatterns = []*regexp.Regexp{
		regexp.MustCompile(`(\d+(?:[.,]\d+)?)\s*(ml|l|kg|g|gr)\b`),
		regexp.MustCompile(`(\d+(?:[.,]\d+)?)\s*(litar|mililitar|kilogram|gram)`),
	}

	n.removePatterns = []*regexp.Regexp{
		regexp.MustCompile(`\b(supreme|pure|plus|ultra|max|extreme|advanced|pro)\b`),
		regexp.MustCompile(`\b(novo|new|original)\b`),
		regexp.MustCompile(`[®™]`),
		regexp.MustCompile(`–|-`),
	}

	return n
}

// Normalize processes a product title and returns normalized data
func (n *PharmaNormalizer) Normalize(title string) ProcessedProduct {
	cleanTitle := n.cleanTitle(title)
	attributes := n.extractAttributes(cleanTitle)
	normalizedName := n.createNormalizedName(cleanTitle, attributes)
	searchTokens := n.generateSearchTokens(title, normalizedName)
	coreIdentity := n.createCoreProductIdentity(normalizedName, attributes)
	groupKey := n.createGroupKey(normalizedName, attributes)
	similarityKey := n.createSimilarityGroupKey(normalizedName, attributes)

	return ProcessedProduct{
		OriginalTitle:  title,
		NormalizedName: normalizedName,
		Attributes:     attributes,
		SearchTokens:   searchTokens,
		GroupKey:       groupKey,
		SimilarityKey:  similarityKey,
		CoreIdentity:   coreIdentity,
	}
}

// cleanTitle cleans and standardizes the title
func (n *PharmaNormalizer) cleanTitle(title string) string {
	title = strings.ToLower(title)
	
	// Remove non-word characters except spaces, dashes, percent, dots, commas, colons
	reg := regexp.MustCompile(`[^\w\s\-–%.,:]`)
	title = reg.ReplaceAllString(title, " ")

	// Apply remove patterns
	for _, pattern := range n.removePatterns {
		title = pattern.ReplaceAllString(title, " ")
	}

	// Normalize whitespace
	return strings.Join(strings.Fields(title), " ")
}

// extractAttributes extracts all attributes from the title
func (n *PharmaNormalizer) extractAttributes(title string) ExtractedAttributes {
	attrs := ExtractedAttributes{}

	// Extract brand
	attrs.Brand = n.extractBrand(title)

	// Extract dosage
	attrs.DosageValue, attrs.DosageUnit = n.extractDosage(title)

	// Extract quantity
	attrs.Quantity = n.extractQuantity(title)

	// Extract volume
	attrs.VolumeValue, attrs.VolumeUnit = n.extractVolume(title)

	// Extract form
	attrs.Form = n.extractForm(title)

	// Extract SPF
	attrs.SPFValue = n.extractSPF(title)

	// Extract product name
	attrs.ProductName = n.extractProductName(title, attrs)

	return attrs
}

// extractBrand extracts brand from title
func (n *PharmaNormalizer) extractBrand(title string) string {
	titleLower := strings.ToLower(title)

	// Check brand mappings
	for brandKey, brandValue := range n.brandMappings {
		if strings.Contains(titleLower, brandKey) {
			return brandValue
		}
	}

	// Check if first word is uppercase and long enough
	words := strings.Fields(title)
	if len(words) >= 2 {
		first := words[0]
		if len(first) > 2 && isAllUpper(first) {
			return strings.Title(first)
		}
	}

	return ""
}

// extractDosage extracts dosage information
func (n *PharmaNormalizer) extractDosage(title string) (float64, string) {
	for _, pattern := range n.dosagePatterns {
		matches := pattern.FindStringSubmatch(title)
		if len(matches) >= 3 {
			value, err := strconv.ParseFloat(strings.ReplaceAll(matches[1], ",", "."), 64)
			if err != nil {
				continue
			}
			unit := strings.ToLower(matches[2])
			if mappedUnit, ok := n.unitMappings[unit]; ok {
				unit = mappedUnit
			}
			return value, unit
		}
	}
	return 0, ""
}

// extractQuantity extracts quantity information
func (n *PharmaNormalizer) extractQuantity(title string) int {
	for _, pattern := range n.quantityPatterns {
		matches := pattern.FindStringSubmatch(title)
		if len(matches) >= 2 {
			value, err := strconv.Atoi(matches[1])
			if err == nil {
				return value
			}
		}
	}
	return 0
}

// extractVolume extracts volume/weight information
func (n *PharmaNormalizer) extractVolume(title string) (float64, string) {
	for _, pattern := range n.volumePatterns {
		matches := pattern.FindStringSubmatch(title)
		if len(matches) >= 3 {
			value, err := strconv.ParseFloat(strings.ReplaceAll(matches[1], ",", "."), 64)
			if err != nil {
				continue
			}
			unit := strings.ToLower(matches[2])
			if mappedUnit, ok := n.unitMappings[unit]; ok {
				unit = mappedUnit
			}
			
			// Skip small dosages that might be confused with volume
			if (unit == "mg" || unit == "mcg") && value < 1000 {
				continue
			}
			
			return value, unit
		}
	}
	return 0, ""
}

// extractForm extracts product form
func (n *PharmaNormalizer) extractForm(title string) string {
	titleLower := strings.ToLower(title)

	for formKey, formValue := range n.formMappings {
		if strings.Contains(titleLower, formKey) {
			return formValue
		}
	}

	// Additional checks
	if strings.Contains(titleLower, "caps") || strings.Contains(titleLower, "capsule") {
		return "capsule"
	}
	if strings.Contains(titleLower, "tab") || strings.Contains(titleLower, "tablet") {
		return "tablet"
	}
	if strings.Contains(titleLower, "powder") || strings.Contains(titleLower, "gr") {
		return "powder"
	}

	return ""
}

// extractSPF extracts SPF value
func (n *PharmaNormalizer) extractSPF(title string) int {
	spfPattern := regexp.MustCompile(`spf\s*(\d+(?:\.\d+)?)`)
	matches := spfPattern.FindStringSubmatch(strings.ToLower(title))
	if len(matches) >= 2 {
		if value, err := strconv.ParseFloat(matches[1], 64); err == nil {
			return int(value) // Convert float to int (e.g., 3.75 becomes 3)
		}
	}
	return 0
}

// extractProductName extracts the core product name
func (n *PharmaNormalizer) extractProductName(title string, attrs ExtractedAttributes) string {
	name := title

	// Remove brand
	if attrs.Brand != "" {
		brandPattern := regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(attrs.Brand) + `\b`)
		name = brandPattern.ReplaceAllString(name, "")
	}

	// Remove dosage
	if attrs.DosageValue > 0 && attrs.DosageUnit != "" {
		dosagePattern := regexp.MustCompile(fmt.Sprintf(`(?i)\b%v\s*%s\b`, attrs.DosageValue, regexp.QuoteMeta(attrs.DosageUnit)))
		name = dosagePattern.ReplaceAllString(name, "")
	}

	// Remove quantity
	if attrs.Quantity > 0 {
		qtyPattern := regexp.MustCompile(fmt.Sprintf(`(?i)\b%d\s*\w*\b`, attrs.Quantity))
		name = qtyPattern.ReplaceAllString(name, "")
	}

	// Remove volume
	if attrs.VolumeValue > 0 && attrs.VolumeUnit != "" {
		volPattern := regexp.MustCompile(fmt.Sprintf(`(?i)\b%v\s*%s\b`, attrs.VolumeValue, regexp.QuoteMeta(attrs.VolumeUnit)))
		name = volPattern.ReplaceAllString(name, "")
	}

	// Clean up
	name = strings.Join(strings.Fields(name), " ")
	name = strings.Trim(name, " -–,")

	return name
}

// createNormalizedName creates normalized product name
func (n *PharmaNormalizer) createNormalizedName(title string, attrs ExtractedAttributes) string {
	var parts []string

	if attrs.ProductName != "" {
		parts = append(parts, attrs.ProductName)
	} else {
		parts = append(parts, title)
	}

	normalized := strings.ToLower(strings.Join(parts, " "))

	// Apply core product mappings
	for old, new := range n.coreProductMappings {
		normalized = strings.ReplaceAll(normalized, old, new)
	}

	return strings.TrimSpace(normalized)
}

// createCoreProductIdentity creates core product identity for grouping with aggressive normalization
func (n *PharmaNormalizer) createCoreProductIdentity(title string, attrs ExtractedAttributes) string {
	coreName := attrs.ProductName
	if coreName == "" {
		coreName = title
	}
	coreName = strings.ToLower(strings.TrimSpace(coreName))

	// Normalize spacing and punctuation
	coreName = regexp.MustCompile(`\s*\+\s*`).ReplaceAllString(coreName, " + ")
	coreName = regexp.MustCompile(`\s*-\s*`).ReplaceAllString(coreName, " ")
	coreName = regexp.MustCompile(`\s+`).ReplaceAllString(coreName, " ")

	// AGGRESSIVE BRAND REMOVAL - Remove all known brands first
	brandPatterns := []*regexp.Regexp{
		regexp.MustCompile(`(?i)\b(babytol|centrum|solgar|now|natural wealth|nature|naturals|strong nature|terranova|bivits activa|hedera vita|mustela|biofar|cardiovitamin)\b`),
		regexp.MustCompile(`(?i)\b(maybelline new york|vichy|garnier|l'oreal paris|rimmel|bourjois|essie|eucerin|deborah milano|golden rose)\b`),
		regexp.MustCompile(`(?i)\b(optimum|gnc|vitacost|kirkland|life|source|nordic|carlson|thorne|garden|rainbow|bluebonnet)\b`),
		regexp.MustCompile(`(?i)\b(puritan|pride|twinlab|jarrow|swanson|country|doctor's best|nature's way|nature made)\b`),
		regexp.MustCompile(`(?i)\b(naughty boy|oneraw|nocco|maxler|applied|esi|cellzoom|moonstruck|caretaker|yambam|tigger)\b`),
		regexp.MustCompile(`(?i)\b(la roche posay|la roche-posay|lrp|sebamed)\b`),
	}

	for _, pattern := range brandPatterns {
		coreName = pattern.ReplaceAllString(coreName, " ")
	}

	// Apply core product mappings FIRST (most important)
	for original, normalized := range n.coreProductMappings {
		if strings.Contains(coreName, original) {
			coreName = strings.ReplaceAll(coreName, original, normalized)
		}
	}

	// ENHANCED PRODUCT CATEGORY EXTRACTION
	// Extract core product types more aggressively - ORDER MATTERS!
	productExtractionPatterns := []struct {
		pattern     *regexp.Regexp
		replacement string
	}{
		// Specific vitamins first (most specific to least specific)
		{regexp.MustCompile(`(?i)\b.*vitamin\s*d\s*3?\b.*`), "vitamin d"},
		{regexp.MustCompile(`(?i)\b.*vitamin\s*c\b.*`), "vitamin c"},
		{regexp.MustCompile(`(?i)\b.*vitamin\s*e\b.*`), "vitamin e"},
		{regexp.MustCompile(`(?i)\b.*vitamin\s*a\b.*`), "vitamin a"},
		{regexp.MustCompile(`(?i)\b.*vitamin\s*k\s*1?\b.*`), "vitamin k"},
		{regexp.MustCompile(`(?i)\b.*vitamin\s*b\s*12?\b.*`), "vitamin b12"},
		{regexp.MustCompile(`(?i)\b.*vitamin\s*b\s*6\b.*`), "vitamin b6"},
		{regexp.MustCompile(`(?i)\b.*vitamin\s*b\b.*`), "b complex"},
		{regexp.MustCompile(`(?i)\b.*(biotin|niacin|folate|folic)\b.*`), "b complex"},
		{regexp.MustCompile(`(?i)\b.*(multivitamin|multi)\b.*`), "multivitamin"},
		{regexp.MustCompile(`(?i)\b.*vitamin.*`), "multivitamin"}, // Catch-all for other vitamins
		
		// Minerals
		{regexp.MustCompile(`(?i)\b.*(calcium)\b.*`), "calcium"},
		{regexp.MustCompile(`(?i)\b.*(magnesium)\b.*`), "magnesium"},
		{regexp.MustCompile(`(?i)\b.*(zinc)\b.*`), "zinc"},
		{regexp.MustCompile(`(?i)\b.*(iron)\b.*`), "iron"},
		{regexp.MustCompile(`(?i)\b.*(selenium)\b.*`), "selenium"},
		
		// Supplements
		{regexp.MustCompile(`(?i)\b.*(omega|fish oil|dha|epa)\b.*`), "omega3"},
		{regexp.MustCompile(`(?i)\b.*(protein|whey|casein)\b.*`), "protein"},
		{regexp.MustCompile(`(?i)\b.*(creatine)\b.*`), "creatine"},
		{regexp.MustCompile(`(?i)\b.*(probiotik|probiotic)\b.*`), "probiotic"},
		{regexp.MustCompile(`(?i)\b.*(coenzyme|coq10|ubiquinol)\b.*`), "coq10"},
		{regexp.MustCompile(`(?i)\b.*(glucosamine|chondroitin)\b.*`), "joint supplement"},
		
		// Skincare - specific products first
		{regexp.MustCompile(`(?i)\b.*(spf|sun|zaštitna|sunscreen|soleil|beach|protect)\b.*`), "sunscreen"},
		{regexp.MustCompile(`(?i)\b.*(krema|cream)\b.*`), "cream"},
		{regexp.MustCompile(`(?i)\b.*(losion|lotion|milk)\b.*`), "lotion"},
		{regexp.MustCompile(`(?i)\b.*(serum)\b.*`), "serum"},
		{regexp.MustCompile(`(?i)\b.*(gel)\b.*`), "gel"},
		{regexp.MustCompile(`(?i)\b.*(šampon|shampoo)\b.*`), "shampoo"},
		{regexp.MustCompile(`(?i)\b.*(balm|balsam)\b.*`), "balm"},
		{regexp.MustCompile(`(?i)\b.*(maska|mask)\b.*`), "mask"},
		{regexp.MustCompile(`(?i)\b.*(cleanser|čistač)\b.*`), "cleanser"},
		
		// Cosmetics categories
		{regexp.MustCompile(`(?i)\b.*(maskara|mascara)\b.*`), "mascara"},
		{regexp.MustCompile(`(?i)\b.*(puder|powder|foundation)\b.*`), "foundation"},
		{regexp.MustCompile(`(?i)\b.*(korektor|concealer)\b.*`), "concealer"},
		{regexp.MustCompile(`(?i)\b.*(lak|polish|nail)\b.*`), "nail polish"},
		{regexp.MustCompile(`(?i)\b.*(sjaj|gloss|lip)\b.*`), "lip gloss"},
		{regexp.MustCompile(`(?i)\b.*(rumenilo|blush)\b.*`), "blush"},
		{regexp.MustCompile(`(?i)\b.*(olovka|pencil|liner)\b.*`), "pencil"},
	}

	// Apply extraction patterns - order matters, take first match
	for _, patternInfo := range productExtractionPatterns {
		if patternInfo.pattern.MatchString(coreName) {
			coreName = patternInfo.replacement
			break // Take first match
		}
	}

	// Remove ALL modifiers more aggressively
	modifierPatterns := []*regexp.Regexp{
		regexp.MustCompile(`(?i)\b(high|low|extra|super|mega|micro|nano|ultra|max|extreme|advanced|pro)\b`),
		regexp.MustCompile(`(?i)\b(strength|potency|dose|formula|complex|special|premium|professional|deluxe)\b`),
		regexp.MustCompile(`(?i)\b(fast|slow|quick|extended|release|acting|lasting|long|short)\b`),
		regexp.MustCompile(`(?i)\b(natural|organic|synthetic|pure|clean|fresh|new|original|classic)\b`),
		regexp.MustCompile(`(?i)\b(for|with|without|free|plus|extra|added|enriched|fortified)\b`),
		regexp.MustCompile(`(?i)\b(men|women|kids|children|adult|senior|baby|junior)\b`),
		regexp.MustCompile(`(?i)\b(morning|evening|night|day|daily|weekly)\b`),
		regexp.MustCompile(`(?i)\b\d+\s*(mg|g|mcg|iu|ml|caps|tabs|tablet|capsule|kom|kesica|kapsula)\b`),
		regexp.MustCompile(`(?i)\b(twist|off|kaps|kapsula|kapsule|tableta|tablet|capsule|cap|soft|gel|liquid|powder)\b`),
		regexp.MustCompile(`(?i)\b[a-z]*\d+[a-z]*\b`),  // Remove any alphanumeric codes
		regexp.MustCompile(`(?i)\b\d+\s*(x|kom|ks|pc|pcs|pieces|\.|,)\b`),
		regexp.MustCompile(`(?i)\b(color|colour|shade|tone|nr|no|broj|br)\b`),
		regexp.MustCompile(`(?i)\b(a\d+|x\d+|\d+x|\d+ml|\d+g|\d+mg|\d+mcg)\b`),
		regexp.MustCompile(`(?i)\b(activa|provitamine|zaštitna|healthy|mix|finish|matte|gloss|repair|plus)\b`),
	}

	for _, pattern := range modifierPatterns {
		coreName = pattern.ReplaceAllString(coreName, " ")
	}

	// Clean up whitespace and remove short words
	words := strings.Fields(coreName)
	var cleanWords []string
	for _, word := range words {
		word = strings.TrimSpace(word)
		// Keep words that are at least 3 characters OR important short words
		if len(word) >= 3 || (len(word) == 2 && (word == "d3" || word == "k1" || word == "c" || word == "e" || word == "a")) {
			cleanWords = append(cleanWords, word)
		}
	}
	coreName = strings.Join(cleanWords, " ")

	// Final enhanced normalizations
	finalNormalizations := map[string]string{
		"vitamin d":        "vitamin d",
		"vitamin c":        "vitamin c", 
		"vitamin e":        "vitamin e",
		"vitamin a":        "vitamin a",
		"vitamin b12":      "vitamin b12",
		"vitamin b6":       "vitamin b6",
		"vitamin k":        "vitamin k",
		"b-vitamin":        "b complex",
		"protein powder":   "protein",
		"whey isolate":     "protein",
		"whey concentrate": "protein",
		"casein protein":   "protein",
		"amino acid":       "amino acids",
		"fish oil":         "omega3",
		"krill oil":        "omega3",
		"cod liver oil":    "omega3",
		"joint support":    "joint supplement",
		"nail polish":      "nail polish",
		"lip gloss":        "lip gloss",
		"sun cream":        "sunscreen",
		"sun lotion":       "sunscreen",
	}

	// Apply final normalizations
	for old, new := range finalNormalizations {
		if coreName == old || strings.Contains(coreName, old) {
			coreName = new
			break
		}
	}

	// If coreName is still too long or complex, try to simplify further
	if len(strings.Fields(coreName)) > 3 {
		words := strings.Fields(coreName)
		if len(words) > 3 {
			// Keep only first 2-3 most meaningful words
			coreName = strings.Join(words[:min(3, len(words))], " ")
		}
	}

	result := strings.TrimSpace(coreName)
	
	// Don't return empty string
	if result == "" {
		// Fallback to a simplified version of original title
		fallback := strings.ToLower(title)
		fallback = regexp.MustCompile(`[^\w\s]`).ReplaceAllString(fallback, " ")
		words := strings.Fields(fallback)
		if len(words) > 0 {
			return words[0]
		}
		return "product"
	}
	
	return result
}

// Helper function for min
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// createGroupKey creates group key for similar products with aggressive grouping
func (n *PharmaNormalizer) createGroupKey(normalizedName string, attrs ExtractedAttributes) string {
	coreIdentity := n.createCoreProductIdentity(normalizedName, attrs)
	
	// Start with just the core product identity
	parts := []string{fmt.Sprintf("product:%s", coreIdentity)}

	// Only add form if it's a major differentiator (and not cosmetics)
	// For supplements/medicines, don't distinguish between tablets/capsules/powder - they're equivalent for price comparison
	// For skincare, group cream/lotion together, gel separately, etc.
	if attrs.Form != "" {
		skincareGroups := map[string]string{
			"cream":     "topical",
			"lotion":    "topical", 
			"balm":      "topical",
			"gel":       "gel",
			"serum":     "serum",
			"cleanser":  "cleanser",
			"mask":      "treatment",
			"sunscreen": "sunscreen",
		}
		
		cosmeticsGroups := map[string]string{
			"foundation": "foundation",
			"concealer":  "concealer", 
			"mascara":    "mascara",
			"nail polish": "nail",
			"lip gloss":  "lip",
			"pencil":     "pencil",
		}
		
		// Check if it's skincare
		if groupedForm, ok := skincareGroups[attrs.Form]; ok {
			parts = append(parts, fmt.Sprintf("form:%s", groupedForm))
		} else if groupedForm, ok := cosmeticsGroups[attrs.Form]; ok {
			parts = append(parts, fmt.Sprintf("form:%s", groupedForm))
		}
		// For supplements, don't add form at all - tablet vs capsule doesn't matter for price comparison
	}

	// For supplements, use wider dosage ranges to group more products together
	// For cosmetics/skincare, don't use dosage at all
	if attrs.DosageValue > 0 && attrs.DosageUnit != "" && n.isSupplementProduct(coreIdentity) {
		dosageRange := n.getWideDosageRange(coreIdentity, attrs.DosageValue, attrs.DosageUnit)
		if dosageRange != "unknown" {
			parts = append(parts, fmt.Sprintf("dosage:%s", dosageRange))
		}
	}

	// Use much broader quantity ranges, only for supplements
	if attrs.Quantity > 0 && n.isSupplementProduct(coreIdentity) {
		var qtyRange string
		if attrs.Quantity <= 60 {
			qtyRange = "standard" // 30-60 capsules/tablets
		} else if attrs.Quantity <= 120 {
			qtyRange = "large"    // 90-120 capsules/tablets
		} else {
			qtyRange = "bulk"     // 150+ capsules/tablets
		}
		parts = append(parts, fmt.Sprintf("qty:%s", qtyRange))
	}

	return strings.Join(parts, "_")
}

// isSupplementProduct determines if a product is a supplement/vitamin
func (n *PharmaNormalizer) isSupplementProduct(coreIdentity string) bool {
	supplementKeywords := []string{
		"vitamin", "mineral", "protein", "omega", "creatine", "probiotic", 
		"multivitamin", "coq10", "calcium", "magnesium", "zinc", "iron", 
		"selenium", "joint", "amino", "b complex",
	}
	
	identityLower := strings.ToLower(coreIdentity)
	for _, keyword := range supplementKeywords {
		if strings.Contains(identityLower, keyword) {
			return true
		}
	}
	return false
}

// getWideDosageRange creates much broader dosage ranges for better grouping
func (n *PharmaNormalizer) getWideDosageRange(productIdentity string, dosageValue float64, dosageUnit string) string {
	if dosageValue == 0 || dosageUnit == "" {
		return "unknown"
	}

	// Normalize dosage to common units
	normalizedValue := dosageValue
	normalizedUnit := strings.ToLower(dosageUnit)

	// Convert to standard units
	switch normalizedUnit {
	case "mcg", "μg":
		normalizedValue = dosageValue / 1000 // Convert to mg
		normalizedUnit = "mg"
	case "g", "gr":
		normalizedValue = dosageValue * 1000 // Convert to mg
		normalizedUnit = "mg"
	case "iu", "ie":
		normalizedUnit = "iu"
	}

	// Define VERY wide ranges for better grouping
	identity := strings.ToLower(productIdentity)
	
	if strings.Contains(identity, "vitamin d") {
		// Vitamin D ranges (IU)
		if normalizedUnit == "iu" {
			if normalizedValue <= 2000 {
				return "low-iu"
			} else if normalizedValue <= 5000 {
				return "medium-iu"
			} else {
				return "high-iu"
			}
		}
	}
	
	if strings.Contains(identity, "vitamin c") {
		// Vitamin C ranges (mg)  
		if normalizedUnit == "mg" {
			if normalizedValue <= 500 {
				return "low-mg"
			} else if normalizedValue <= 1500 {
				return "medium-mg"
			} else {
				return "high-mg"
			}
		}
	}
	
	if strings.Contains(identity, "protein") {
		// Protein ranges (g per serving)
		if normalizedUnit == "mg" && normalizedValue >= 1000 {
			// Convert mg to g for proteins
			normalizedValue = normalizedValue / 1000
			normalizedUnit = "g"
		}
		if normalizedUnit == "g" {
			if normalizedValue <= 25 {
				return "standard-g"
			} else {
				return "high-g"
			}
		}
	}
	
	// Default wide ranges for other supplements
	if normalizedUnit == "mg" {
		if normalizedValue <= 250 {
			return "low-mg"
		} else if normalizedValue <= 1000 {
			return "medium-mg"
		} else {
			return "high-mg"
		}
	}
	
	if normalizedUnit == "iu" {
		if normalizedValue <= 1000 {
			return "low-iu"
		} else if normalizedValue <= 5000 {
			return "medium-iu"
		} else {
			return "high-iu"
		}
	}

	return "standard-" + normalizedUnit
}

// createSimilarityGroupKey creates broader similarity key for maximum grouping
func (n *PharmaNormalizer) createSimilarityGroupKey(normalizedName string, attrs ExtractedAttributes) string {
	coreIdentity := n.createCoreProductIdentity(normalizedName, attrs)
	
	// For similarity, use ONLY the core product identity
	// This will group ALL variations of a product together for maximum price comparison
	return fmt.Sprintf("sim:%s", coreIdentity)
}

// getDosageRange categorizes dosage into ranges
func (n *PharmaNormalizer) getDosageRange(productIdentity string, dosageValue float64, dosageUnit string) string {
	if dosageValue == 0 || dosageUnit == "" {
		return "unknown"
	}

	// Normalize dosage to common units
	normalizedValue := dosageValue
	normalizedUnit := strings.ToLower(dosageUnit)

	// Convert to standard units
	switch normalizedUnit {
	case "mcg", "μg":
		normalizedValue = dosageValue / 1000 // Convert to mg
		normalizedUnit = "mg"
	case "g", "gr":
		normalizedValue = dosageValue * 1000 // Convert to mg
		normalizedUnit = "mg"
	case "iu", "ie":
		normalizedUnit = "iu"
	}

	// Define ranges based on product type
	var ranges []struct {
		min, max float64
		category string
	}

	switch productIdentity {
	case "vitamin d":
		ranges = []struct {
			min, max float64
			category string
		}{
			{0, 1000, "low"},
			{1000, 2500, "medium"},
			{2500, 5000, "high"},
			{5000, 10000, "very-high"},
			{10000, 999999, "ultra-high"},
		}
	case "vitamin c":
		ranges = []struct {
			min, max float64
			category string
		}{
			{0, 250, "low"},
			{250, 500, "medium"},
			{500, 1000, "high"},
			{1000, 2000, "very-high"},
			{2000, 999999, "ultra-high"},
		}
	case "protein":
		ranges = []struct {
			min, max float64
			category string
		}{
			{0, 20, "low"},
			{20, 30, "medium"},
			{30, 40, "high"},
			{40, 999999, "very-high"},
		}
	default:
		ranges = []struct {
			min, max float64
			category string
		}{
			{0, 100, "low"},
			{100, 500, "medium"},
			{500, 1000, "high"},
			{1000, 999999, "very-high"},
		}
	}

	for _, r := range ranges {
		if normalizedValue >= r.min && normalizedValue < r.max {
			return fmt.Sprintf("%s-%s", r.category, normalizedUnit)
		}
	}

	return fmt.Sprintf("unknown-%s", normalizedUnit)
}

// generateSearchTokens generates search tokens for fuzzy matching with PostgreSQL safety
func (n *PharmaNormalizer) generateSearchTokens(original, normalized string) []string {
	tokens := make(map[string]bool)

	// Add words from original and normalized
	for _, word := range strings.Fields(strings.ToLower(original)) {
		if len(word) > 2 && isValidToken(word) {
			tokens[word] = true
		}
	}

	for _, word := range strings.Fields(normalized) {
		if len(word) > 2 && isValidToken(word) {
			tokens[word] = true
		}
	}

	// Add normalized versions without diacritics (but only valid parts)
	cleanOriginal := cleanForToken(removeDiacritics(strings.ToLower(original)))
	cleanNormalized := cleanForToken(removeDiacritics(normalized))
	
	if len(cleanOriginal) > 2 && isValidToken(cleanOriginal) {
		tokens[cleanOriginal] = true
	}
	if len(cleanNormalized) > 2 && isValidToken(cleanNormalized) {
		tokens[cleanNormalized] = true
	}

	// Skip trigrams for now as they can cause issues with special characters
	// Focus on word-based tokens which are more useful for search anyway

	// Convert map keys to slice and clean
	result := make([]string, 0, len(tokens))
	for token := range tokens {
		if isValidToken(token) {
			result = append(result, token)
		}
	}

	// Limit number of tokens to prevent issues
	if len(result) > 50 {
		result = result[:50]
	}

	return result
}

// isValidToken checks if a token is safe for PostgreSQL array storage
func isValidToken(token string) bool {
	if len(token) < 3 || len(token) > 50 {
		return false
	}
	
	// Check for problematic characters that could break PostgreSQL arrays
	problematicChars := `"'{}[]\\`
	for _, char := range problematicChars {
		if strings.ContainsRune(token, char) {
			return false
		}
	}
	
	// Must contain at least some alphanumeric characters
	hasAlphaNum := false
	for _, r := range token {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			hasAlphaNum = true
			break
		}
	}
	
	return hasAlphaNum
}

// cleanForToken cleans a string to be safe for token storage
func cleanForToken(s string) string {
	// Remove problematic characters
	cleaned := strings.Map(func(r rune) rune {
		if r == '"' || r == '\'' || r == '{' || r == '}' || r == '[' || r == ']' || r == '\\' {
			return -1 // Remove character
		}
		return r
	}, s)
	
	// Replace multiple spaces with single space
	cleaned = regexp.MustCompile(`\s+`).ReplaceAllString(cleaned, " ")
	return strings.TrimSpace(cleaned)
}

// Helper functions

// isAllUpper checks if string is all uppercase
func isAllUpper(s string) bool {
	for _, r := range s {
		if unicode.IsLetter(r) && !unicode.IsUpper(r) {
			return false
		}
	}
	return true
}

// removeDiacritics removes diacritical marks from text
func removeDiacritics(s string) string {
	// Simple ASCII transliteration - this could be enhanced
	replacements := map[string]string{
		"š": "s", "č": "c", "ć": "c", "ž": "z", "đ": "d",
		"Š": "S", "Č": "C", "Ć": "C", "Ž": "Z", "Đ": "D",
		"á": "a", "à": "a", "ä": "a", "â": "a", "ā": "a", "ă": "a", "ą": "a",
		"é": "e", "è": "e", "ë": "e", "ê": "e", "ē": "e", "ĕ": "e", "ę": "e",
		"í": "i", "ì": "i", "ï": "i", "î": "i", "ī": "i", "ĭ": "i", "į": "i",
		"ó": "o", "ò": "o", "ö": "o", "ô": "o", "ō": "o", "ŏ": "o", "ő": "o",
		"ú": "u", "ù": "u", "ü": "u", "û": "u", "ū": "u", "ŭ": "u", "ů": "u", "ű": "u", "ų": "u",
	}

	result := s
	for old, new := range replacements {
		result = strings.ReplaceAll(result, old, new)
	}
	return result
}