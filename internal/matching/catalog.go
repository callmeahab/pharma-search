package matching

import (
	"crypto/sha256"
	"encoding/hex"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const CatalogIdentityVersion = "sku-v2"

var DictionaryVersion = func() string {
	h := sha256.New()
	for _, data := range [][]byte{ingredientsJSON, brandsJSON, stopwordsJSON, categoryConceptsJSON} {
		h.Write(data)
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))[:16]
}()

// SKUIdentity is deliberately more conservative than the historical ingredient
// grouper. Family membership never establishes price comparability.
type SKUIdentity struct {
	ID           string   `json:"id"`
	FamilyID     string   `json:"family_id"`
	Brand        string   `json:"brand"`
	Display      string   `json:"display"`
	Signature    string   `json:"signature"`
	Form         string   `json:"form"`
	Quantity     int      `json:"quantity"`
	Volume       float64  `json:"volume"`
	VolumeUnit   string   `json:"volume_unit"`
	Dosage       float64  `json:"dosage"`
	DosageUnit   string   `json:"dosage_unit"`
	Comparable   bool     `json:"comparable"`
	Method       string   `json:"method"`
	UnitQuantity float64  `json:"unit_quantity"`
	UnitLabel    string   `json:"unit_label"`
	Tokens       []string `json:"tokens"`
}

var brandAliases = map[string]string{
	"biotech": "BioTechUSA", "biotech usa": "BioTechUSA", "biotechusa": "BioTechUSA",
	"7nutrition": "7Nutrition", "7 nutrition": "7Nutrition",
	"jp": "Institut Josif Pančić", "ijp": "Institut Josif Pančić", "insjp": "Institut Josif Pančić",
	"josif pancic": "Institut Josif Pančić", "institut josif pancic": "Institut Josif Pančić",
	"institut dr josif pancic": "Institut Josif Pančić", "la roche posay": "La Roche Posay",
	"optimum": "Optimum Nutrition", "optimum nutrition": "Optimum Nutrition",
	"doppel herz": "Doppelherz", "doppelherz": "Doppelherz",
}

func CanonicalBrand(brand string) string {
	n := NormalizeText(brand)
	if b, ok := brandAliases[n]; ok {
		return b
	}
	return titleCaseWords(n)
}

// Longest match avoids choosing a short brand inside another manufacturer's name.
func DetectBrand(title string) string {
	words := strings.Fields(NormalizeText(title))
	best := ""
	for i := range words {
		for n := 1; n <= 6 && i+n <= len(words); n++ {
			b := strings.Join(words[i:i+n], " ")
			if _, ingredient := aliasIndex[b]; ingredient {
				continue
			}
			_, alias := brandAliases[b]
			if len(b) > len(best) && (brandStrip[b] || brandKeep[b] || cosmeticBrands[b] || (alias && len(b) > 2)) {
				best = b
			}
		}
	}
	return CanonicalBrand(best)
}

var (
	measureRE              = regexp.MustCompile(`(?i)(\d+(?:[.,]\d+)?)\s*(mcg|ug|μg|µg|mg|kg|gr|ml|iu|ij|g|l)\b`)
	quantityRE             = regexp.MustCompile(`(?i)\b(\d+)\s*(?:tableta|tablete|tablet|kapsula|kapsule|capsules|caps|softgels|kesica|kesice|ampula|ampule|komada|kom|pcs|pastila|lozenge|pelena|pelene)\b`)
	packRE                 = regexp.MustCompile(`(?i)\b[aaxх×]\s*(\d+)\b`)
	countTimesRE           = regexp.MustCompile(`(?i)\b(\d+)\s*[xх×]\s*\d`)
	alphaNumericBoundaryRE = regexp.MustCompile(`([a-z])([0-9])|([0-9])([a-z])`)
	wordAliases            = map[string]string{
		"magnesium": "magnezijum", "magnesijum": "magnezijum", "magnesiuma": "magnezijum",
		"citrate": "citrat", "citrata": "citrat", "citrati": "citrat",
		"bisglycinate": "bisglicinat", "bisglycinat": "bisglicinat", "bisglicinata": "bisglicinat",
		"glycinate": "glicinat", "oxide": "oksid", "sulphate": "sulfat", "sulfate": "sulfat",
		"calcium": "kalcijum", "zinc": "cink", "vitamins": "vitamini",
		"tableta": "tablete", "tablet": "tablete", "tablets": "tablete", "tbl": "tablete", "tabl": "tablete",
		"kapsula": "kapsule", "caps": "kapsule", "capsules": "kapsule", "capsule": "kapsule", "cps": "kapsule",
		"kesica": "kesice", "sachets": "kesice", "ampula": "ampule", "drops": "kapi", "spray": "sprej",
		"cream": "krema", "krem": "krema", "lotion": "losion", "powder": "prah",
		"diapers": "pelene", "pelena": "pelene", "sapunom": "sapun", "komada": "kom", "pcs": "kom",
		"iui": "iu", "ij": "iu", "ug": "mcg", "gr": "g", "ferveks": "fervex",
		"vanilla": "vanila", "chocolate": "cokolada", "strawberry": "jagoda",
	}
)

func normalizedWords(text string) []string {
	text = strings.NewReplacer("µg", "mcg", "μg", "mcg").Replace(text)
	t := NormalizeText(text)
	// Repeated replacement handles 100x10mg and D3 without losing any numeric token.
	for i := 0; i < 3; i++ {
		t = alphaNumericBoundaryRE.ReplaceAllString(t, "$1$3 $2$4")
	}
	words := strings.Fields(t)
	for i, w := range words {
		if a, ok := wordAliases[w]; ok {
			words[i] = a
		}
	}
	return words
}

func CatalogTokens(text string) []string {
	set := map[string]bool{}
	for _, w := range normalizedWords(text) {
		if !queryStopwords[w] && w != "" {
			set[w] = true
		}
	}
	// Canonical ingredient tokens improve language recall without consuming the
	// original qualifier (citrat/bisglicinat), stage, size, or single-digit number.
	for _, c := range CanonicalIngredients(text) {
		set["ingredient:"+strings.ReplaceAll(c, " ", "")] = true
	}
	out := make([]string, 0, len(set))
	for w := range set {
		out = append(out, w)
	}
	sort.Strings(out)
	return out
}

type QueryPlan struct {
	Original   string   `json:"original"`
	Text       string   `json:"text"`
	Correction string   `json:"correction,omitempty"`
	Required   []string `json:"required"`
	Version    string   `json:"version"`
}

func ParseCatalogQuery(query string) QueryPlan {
	p := QueryPlan{Original: strings.TrimSpace(query), Text: NormalizeText(query), Version: CatalogIdentityVersion}
	words := strings.Fields(p.Text)
	fixes := map[string]string{}
	for i, w := range words {
		if w == "ferveks" {
			words[i] = "fervex"
			fixes[w] = "fervex"
			continue
		}
		// Correct a uniquely close, known manufacturer; never fuzzy-correct numbers,
		// concentrations, formulations, or entire arbitrary product titles.
		if len(w) < 5 || numberOnlyPattern.MatchString(w) || alphaNumPattern.MatchString(w) || brandStrip[w] || brandKeep[w] || cosmeticBrands[w] || knownQueryWord(w) {
			continue
		}
		best := ""
		ambiguous := false
		for _, set := range []map[string]bool{brandStrip, brandKeep, cosmeticBrands} {
			for b := range set {
				if strings.Contains(b, " ") || absInt(len(b)-len(w)) > 1 {
					continue
				}
				if editDistanceOne(w, b) {
					if best != "" && best != b {
						ambiguous = true
					}
					best = b
				}
			}
		}
		if best != "" && !ambiguous {
			words[i] = best
			fixes[w] = best
		}
	}
	corrected := strings.Join(words, " ")
	if corrected != p.Text {
		p.Correction = regexp.MustCompile(`[\pL\pN]+`).ReplaceAllStringFunc(query, func(word string) string {
			if replacement, ok := fixes[NormalizeText(word)]; ok {
				return replacement
			}
			return word
		})
		p.Text = corrected
	}
	// Normalize reviewed manufacturer aliases, retaining every other query word.
	for _, b := range sortedBrandAliases() {
		p.Text = strings.TrimSpace(strings.ReplaceAll(" "+p.Text+" ", " "+b+" ", " "+NormalizeText(brandAliases[b])+" "))
	}
	lexical := p.Text
	measurementTokens := []string{}
	for _, m := range measureRE.FindAllStringSubmatch(query, -1) {
		value, _ := strconv.ParseFloat(strings.ReplaceAll(m[1], ",", "."), 64)
		measurementTokens = append(measurementTokens, catalogMeasureToken(value, m[2], CanonicalIngredients(query)))
		lexical = strings.ReplaceAll(lexical, NormalizeText(m[0]), " ")
	}
	canon, leftover := analyzeIngredients(lexical, false)
	set := map[string]bool{}
	for _, token := range measurementTokens {
		set[token] = true
	}
	for _, c := range canon {
		set["ingredient:"+strings.ReplaceAll(c, " ", "")] = true
	}
	for _, w := range normalizedWords(strings.Join(leftover, " ")) {
		if !queryStopwords[w] {
			set[w] = true
		}
	}
	// An ingredient/category alias is allowed to consume its spelling, never an
	// explicit formulation, manufacturer, route, strength, or variant qualifier.
	for _, w := range normalizedWords(p.Text) {
		if formulationToken(w) || brandStrip[w] || brandKeep[w] || cosmeticBrands[w] {
			set[w] = true
		}
	}
	if size := DiaperSize(query); size != "" {
		set["size:"+size] = true
	}
	p.Required = make([]string, 0, len(set))
	for w := range set {
		p.Required = append(p.Required, w)
	}
	sort.Strings(p.Required)
	return p
}

func catalogMeasureToken(value float64, unit string, ingredients []string) string {
	unit = NormalizeUnit(unit)
	if len(ingredients) == 1 && ingredients[0] == "vitamin d3" && unit == "mcg" {
		value *= 40
		unit = "iu"
	}
	switch unit {
	case "kg":
		value *= 1000000000
		unit = "mcg"
	case "g":
		value *= 1000000
		unit = "mcg"
	case "l":
		value *= 1000
		unit = "ml"
	case "mg":
		value *= 1000
		unit = "mcg"
	}
	return "measure:" + formatCompactValue(roundStrength(value)) + unit
}

func formulationToken(w string) bool {
	switch w {
	case "citrat", "bisglicinat", "glicinat", "oksid", "sulfat", "malat", "taurat", "retard", "duopack", "junior", "baby", "forte":
		return true
	}
	return false
}

func knownQueryWord(word string) bool {
	if _, ok := wordAliases[word]; ok {
		return true
	}
	for alias := range aliasIndex {
		for _, w := range strings.Fields(alias) {
			if w == word {
				return true
			}
		}
	}
	return word == "citrat" || word == "bisglicinat" || word == "glicinat" || word == "oksid" || word == "sulfat"
}

func sortedBrandAliases() []string {
	a := make([]string, 0, len(brandAliases))
	for b := range brandAliases {
		a = append(a, b)
	}
	sort.Slice(a, func(i, j int) bool {
		if len(a[i]) != len(a[j]) {
			return len(a[i]) > len(a[j])
		}
		return a[i] < a[j]
	})
	return a
}
func absInt(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
func editDistanceOne(a, b string) bool {
	if a == b {
		return false
	}
	if absInt(len(a)-len(b)) > 1 {
		return false
	}
	i, j, n := 0, 0, 0
	for i < len(a) && j < len(b) {
		if a[i] == b[j] {
			i++
			j++
			continue
		}
		n++
		if n > 1 {
			return false
		}
		if len(a) >= len(b) {
			i++
		}
		if len(b) >= len(a) {
			j++
		}
	}
	if i < len(a) || j < len(b) {
		n++
	}
	return n == 1
}

func fingerprint(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:16])
}

func ValidGTIN(code string) bool {
	if len(code) != 8 && len(code) != 12 && len(code) != 13 && len(code) != 14 {
		return false
	}
	sum := 0
	for i := len(code) - 2; i >= 0; i-- {
		if code[i] < '0' || code[i] > '9' {
			return false
		}
		weight := 3
		if (len(code)-2-i)%2 == 1 {
			weight = 1
		}
		sum += int(code[i]-'0') * weight
	}
	return code[len(code)-1] >= '0' && code[len(code)-1] <= '9' && (10-sum%10)%10 == int(code[len(code)-1]-'0')
}

// BuildSKUIdentity uses source title evidence for equivalence. Existing extracted
// attributes may help discovery but do not fill unknown pack/form fields here.
func BuildSKUIdentity(in GroupKeyInput) SKUIdentity {
	r := SKUIdentity{Display: strings.TrimSpace(in.Title), Brand: CanonicalBrand(in.Brand), Method: "unconfirmed"}
	brandConfirmed := r.Brand != ""
	if _, generic := aliasIndex[NormalizeText(in.Brand)]; generic {
		brandConfirmed = false
		if detected := DetectBrand(in.Title); detected != "" {
			r.Brand = detected
			brandConfirmed = true
		}
	}
	if r.Brand == "" {
		r.Brand = DetectBrand(in.Title)
		brandConfirmed = r.Brand != ""
	}
	t := NormalizeText(in.Title)
	for _, b := range sortedBrandAliases() {
		t = strings.TrimSpace(strings.ReplaceAll(" "+t+" ", " "+b+" ", " "+NormalizeText(brandAliases[b])+" "))
	}
	ingredients := CanonicalIngredients(in.Title)
	if len(ingredients) > 0 {
		r.FamilyID = "family:" + fingerprint(strings.Join(ingredients, "+"))
	} else {
		familyCore := strings.TrimSpace(in.Core)
		if familyCore == "" {
			familyCore = measureRE.ReplaceAllString(in.Title, " ")
			familyCore = quantityRE.ReplaceAllString(familyCore, " ")
			familyCore = packRE.ReplaceAllString(familyCore, " ")
		}
		r.FamilyID = "family:" + fingerprint(NormalizeText(r.Brand+" "+familyCore))
	}
	words := normalizedWords(in.Title)
	for _, w := range words {
		switch w {
		case "tablete", "kapsule", "kesice", "ampule", "kapi", "sprej", "sirup", "krema", "losion", "serum", "prah", "gel", "rastvor":
			if r.Form == "" {
				r.Form = w
			}
		}
	}
	// Distinguish routes even though legacy form aliases treated them as identical.
	for _, w := range words {
		if strings.HasPrefix(w, "vaginal") || strings.HasPrefix(w, "vagitor") {
			r.Form = "vaginalete"
		}
		if strings.HasPrefix(w, "supoz") || w == "cepici" {
			r.Form = "supozitorije"
		}
	}
	for _, re := range []*regexp.Regexp{quantityRE, packRE, countTimesRE} {
		if m := re.FindStringSubmatch(t); len(m) > 1 {
			r.Quantity, _ = strconv.Atoi(m[1])
			break
		}
	}
	// Preserve decimals before NormalizeText turns punctuation into spaces.
	identityTitle := strings.ToLower(in.Title)
	identityTitle = measureRE.ReplaceAllStringFunc(identityTitle, func(m string) string {
		parts := measureRE.FindStringSubmatch(m)
		v, _ := strconv.ParseFloat(strings.ReplaceAll(parts[1], ",", "."), 64)
		u := NormalizeUnit(parts[2])
		if (u == "ml" || u == "l" || u == "g" || u == "kg") && v > 0 {
			if u == "l" {
				v *= 1000
				u = "ml"
			}
			if u == "kg" {
				v *= 1000
				u = "g"
			}
			if v > r.Volume {
				r.Volume = v
				r.VolumeUnit = u
			}
		}
		if u == "mg" || u == "mcg" || u == "iu" {
			if r.Dosage == 0 {
				r.Dosage = v
				r.DosageUnit = u
			}
			if len(ingredients) == 1 && ingredients[0] == "vitamin d3" && u == "mcg" {
				v *= 40
				u = "iu"
			}
			if u == "mg" {
				v *= 1000
				u = "mcg"
			}
		}
		return " measure" + formatCompactValue(roundStrength(v)) + u + " "
	})
	// Publish one deterministic strength label for physically equivalent units.
	if len(ingredients) == 1 && ingredients[0] == "vitamin d3" && r.DosageUnit == "mcg" {
		r.Dosage *= 40
		r.DosageUnit = "iu"
	}
	if r.DosageUnit == "mcg" && r.Dosage >= 1000 {
		r.Dosage /= 1000
		r.DosageUnit = "mg"
	}
	if r.DosageUnit == "mg" && r.Dosage > 0 && r.Dosage < 1 {
		r.Dosage *= 1000
		r.DosageUnit = "mcg"
	}
	identityTitle = quantityRE.ReplaceAllString(identityTitle, " ")
	identityTitle = packRE.ReplaceAllString(identityTitle, " ")
	identityTitle = NormalizeText(identityTitle)
	for _, b := range sortedBrandAliases() {
		identityTitle = strings.TrimSpace(strings.ReplaceAll(" "+identityTitle+" ", " "+b+" ", " "+NormalizeText(brandAliases[b])+" "))
	}
	brandWords := strings.Fields(NormalizeText(r.Brand))
	for _, b := range brandWords {
		identityTitle = strings.TrimSpace(strings.ReplaceAll(" "+identityTitle+" ", " "+b+" ", " "))
	}
	parts := []string{}
	for _, w := range strings.Fields(identityTitle) {
		if a, ok := wordAliases[w]; ok {
			w = a
		}
		if queryStopwords[w] || w == "akcija" || w == "kom" {
			continue
		}
		parts = append(parts, w)
	}
	// Sorting is safe for a single active ingredient. Preserve component order for
	// combinations so strengths cannot silently swap their ingredient association.
	if len(ingredients) <= 1 {
		sort.Strings(parts)
	}
	r.Signature = strings.Join([]string{CatalogIdentityVersion, NormalizeText(r.Brand), strings.Join(parts, " "), r.Form, strconv.Itoa(r.Quantity)}, "|")
	r.Comparable = brandConfirmed && (r.Quantity > 0 || r.Volume > 0) && len(parts) > 0
	if r.Dosage > 0 && r.Quantity == 0 && r.Volume == 0 {
		r.Comparable = false
	}
	if !variantEvidenceComplete(t, in.Category) {
		r.Comparable = false
	}
	if ValidGTIN(in.GTIN) {
		r.Signature = CatalogIdentityVersion + "|gtin:" + in.GTIN + "|" + r.Signature
		r.Comparable = true
		r.Method = "gtin"
	} else if r.Comparable {
		r.Method = "explicit-title"
	}
	if r.Comparable {
		r.ID = "sku:v2:" + fingerprint(r.Signature)
	} else {
		source := in.SourceID
		if source == "" {
			source = in.ProductID
		}
		if source == "" {
			source = in.Title
		}
		r.ID = "offer:v2:" + fingerprint(in.VendorID+"|"+source)
		r.Signature = CatalogIdentityVersion + "|offer:" + in.VendorID + "|" + source
	}
	if r.Quantity > 0 {
		r.UnitQuantity = float64(r.Quantity)
		r.UnitLabel = "kom"
	} else if r.Volume > 0 && !strings.Contains(t, "pelene") && !strings.Contains(t, "diaper") && in.Category != "Medical Devices" {
		r.UnitQuantity = r.Volume
		r.UnitLabel = r.VolumeUnit
	}
	meta := in.Title + " " + r.Brand + " " + r.Form
	for alias, canonical := range brandAliases {
		if canonical == r.Brand {
			meta += " " + alias
		}
	}
	r.Tokens = CatalogTokens(meta)
	// Normalized measures are searchable even when source titles glue units or use
	// equivalent Vitamin-D IU/microgram labels.
	set := map[string]bool{}
	for _, w := range r.Tokens {
		set[w] = true
	}
	for _, m := range measureRE.FindAllStringSubmatch(in.Title, -1) {
		v, _ := strconv.ParseFloat(strings.ReplaceAll(m[1], ",", "."), 64)
		u := NormalizeUnit(m[2])
		set[catalogMeasureToken(v, u, ingredients)] = true
		set[formatCompactValue(v)] = true
		set[u] = true
		if len(ingredients) == 1 && ingredients[0] == "vitamin d3" {
			if u == "mcg" {
				set[formatCompactValue(v*40)] = true
				set["iu"] = true
			}
			if u == "iu" {
				set[formatCompactValue(v/40)] = true
				set["mcg"] = true
			}
		}
	}
	if r.Quantity > 0 {
		set[strconv.Itoa(r.Quantity)] = true
	}
	if size := DiaperSize(in.Title); size != "" {
		set["size:"+size] = true
	}
	r.Tokens = r.Tokens[:0]
	for w := range set {
		r.Tokens = append(r.Tokens, w)
	}
	sort.Strings(r.Tokens)
	return r
}

var diaperSizeRE = regexp.MustCompile(`\b(?:care|pelene|velicina|vel|size|br)\s*[0-8]\b|\b(?:newborn|mini|midi|maxi|junior)\b`)
var flavorRE = regexp.MustCompile(`\b(?:vanila|vanilla|cokolada|chocolate|jagoda|strawberry|banana|cookies|cream|neutral|unflavored|bez ukusa|malina|visnja|le[sš]nik|limun|narandza|mango|kokos|caramel|karamela)\b`)
var shadeRE = regexp.MustCompile(`\b(?:\d{2,4}|nude|red|pink|black|brown|beige|crni|crna|braon|roze|crveni|crvena)\b`)

func variantEvidenceComplete(title, category string) bool {
	if (strings.Contains(title, "pelene") || strings.Contains(title, "diaper")) && !diaperSizeRE.MatchString(title) {
		return false
	}
	if (strings.Contains(title, "whey") || strings.Contains(title, "casein") || strings.Contains(title, "kazein")) && !flavorRE.MatchString(title) {
		return false
	}
	if (strings.Contains(title, "lipstick") || strings.Contains(title, "ruz za usne") || strings.Contains(title, "lak za nokte") || strings.Contains(title, "tecni puder")) && !shadeRE.MatchString(title) {
		return false
	}
	return true
}

func NormalizeSKUForm(form string) string {
	form = NormalizeText(form)
	if strings.HasPrefix(form, "vaginal") || strings.HasPrefix(form, "vagitor") {
		return "vaginalete"
	}
	if strings.HasPrefix(form, "supoz") || form == "cepici" || form == "cepic" {
		return "supozitorije"
	}
	if value, ok := wordAliases[form]; ok {
		return value
	}
	return form
}

func (s SKUIdentity) UnitPrice(price float64) float64 {
	if s.UnitQuantity <= 0 {
		return 0
	}
	return math.Round(price/s.UnitQuantity*100) / 100
}

var diaperExplicitSizeRE = regexp.MustCompile(`\b(?:velicina|vel|size|br|broj)\s*[.:]?\s*([0-8])\b`)
var diaperModelSizeRE = regexp.MustCompile(`\b(?:premium care|active baby|baby dry|harmonie|pants|pampers|molfix|violeta|pelene|pelena)\s*([0-8])\b`)

func diaperContext(text string) bool {
	for _, word := range []string{"pampers", "pelene", "pelena", "molfix", "violeta"} {
		if strings.Contains(text, word) {
			return true
		}
	}
	return false
}
func DiaperSize(text string) string {
	t := strings.Join(normalizedWords(text), " ")
	if !diaperContext(t) {
		return ""
	}
	for _, re := range []*regexp.Regexp{diaperExplicitSizeRE, diaperModelSizeRE} {
		if m := re.FindStringSubmatch(t); len(m) > 1 {
			return m[1]
		}
	}
	return ""
}
