package matching

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

var serbianTextReplacer = strings.NewReplacer(
	"đ", "dj", "Đ", "dj", "č", "c", "Č", "c", "ć", "c", "Ć", "c",
	"š", "s", "Š", "s", "ž", "z", "Ž", "z",
	"љ", "lj", "Љ", "lj", "њ", "nj", "Њ", "nj", "џ", "dz", "Џ", "dz",
	"ђ", "dj", "Ђ", "dj", "ј", "j", "Ј", "j", "ч", "c", "Ч", "c",
	"ћ", "c", "Ћ", "c", "ш", "s", "Ш", "s", "ж", "z", "Ж", "z",
	"а", "a", "А", "a", "б", "b", "Б", "b", "в", "v", "В", "v",
	"г", "g", "Г", "g", "д", "d", "Д", "d", "е", "e", "Е", "e",
	"з", "z", "З", "z", "и", "i", "И", "i", "к", "k", "К", "k",
	"л", "l", "Л", "l", "м", "m", "М", "m", "н", "n", "Н", "n",
	"о", "o", "О", "o", "п", "p", "П", "p", "р", "r", "Р", "r",
	"с", "s", "С", "s", "т", "t", "Т", "t", "у", "u", "У", "u",
	"ф", "f", "Ф", "f", "х", "h", "Х", "h", "ц", "c", "Ц", "c",
)

var (
	numberOnlyPattern = regexp.MustCompile(`^\d+(?:[.,]\d+)*$`)
	alphaNumPattern   = regexp.MustCompile(`^\d+[a-z]+$|^[a-z]+\d+\+?$`)
)

// powderMinGrams: at/above this gram weight a product is a powder/tub (protein,
// gainer), not a cosmetic cream — used to keep flavor "cream" words from making
// it look topical. Cosmetic creams are well below this (30–250 g).
const powderMinGrams = 400

// queryStopwords are dropped from search/identity token lists ("krema za lice"
// must not treat "za" as a required token).
var queryStopwords = map[string]bool{
	"a": true, "i": true, "u": true, "o": true, "za": true, "sa": true,
	"od": true, "na": true, "po": true, "iz": true, "do": true, "se": true,
	"je": true, "ili": true, "the": true, "of": true, "with": true,
	"and": true, "for": true, "in": true,
}

// keepShortToken keeps otherwise-too-short tokens that carry meaning.
var keepShortToken = map[string]bool{"c": true, "d": true, "b": true, "k": true, "e": true, "a": true}

var formAliases = map[string]string{
	"tab": "tablete", "tabl": "tablete", "tableta": "tablete", "tablete": "tablete",
	"kap": "kapsule", "kaps": "kapsule", "kapsula": "kapsule", "kapsule": "kapsule", "caps": "kapsule",
	"capsule": "kapsule", "capsules": "kapsule", "softgel": "kapsule", "softgels": "kapsule",
	"cps": "kapsule", "sirup": "sirup", "sprej": "sprej", "spray": "sprej",
	"kapi": "kapi", "drops": "kapi", "gel": "gel", "gela": "gel",
	// Cream/ointment family collapses to one form: vendors title the SAME topical
	// product as "krem" / "krema" / "mast" / "pomada" interchangeably (e.g. Galenika
	// Pantenol dexpanthenol 5% 30g), so keying them separately fragments the group.
	// Functionally distinct topicals (gel, serum, losion, sprej, kapi) stay separate.
	"krema": "krema", "krem": "krema", "cream": "krema", "mast": "krema",
	"ointment": "krema", "pomada": "krema", "pomast": "krema",
	"losion": "losion", "lotion": "losion", "serum": "serum",
	"rastvor": "rastvor", "solution": "rastvor", "suspenzija": "suspenzija",
	"kesica": "kesice", "kesice": "kesice", "ampula": "ampule", "ampule": "ampule",
	"prah": "prah", "powder": "prah",
	// gummy / jelly vitamins -> one "bombone" form
	"bombone": "bombone", "bombona": "bombone", "gumene": "bombone", "gumeni": "bombone",
	"gumenih": "bombone", "gumena": "bombone", "gumedica": "bombone", "gumedice": "bombone",
	"pektinske": "bombone", "pektinska": "bombone", "pektinski": "bombone",
	"gummy": "bombone", "gummies": "bombone",
}

// NormalizeText lowercases, transliterates Serbian/Cyrillic, and reduces to
// alphanumeric tokens separated by single spaces.
func NormalizeText(text string) string {
	text = strings.TrimSpace(strings.ToLower(text))
	if text == "" {
		return ""
	}
	text = serbianTextReplacer.Replace(text)
	text = strings.ReplaceAll(text, "-", " ")
	text = strings.ReplaceAll(text, "_", " ")

	var b strings.Builder
	lastSpace := true
	for _, r := range text {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			lastSpace = false
			continue
		}
		if !lastSpace {
			b.WriteByte(' ')
			lastSpace = true
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

// Tokenize returns meaningful, de-duplicated query tokens (stopwords removed).
func Tokenize(text string) []string {
	normalized := NormalizeText(text)
	if normalized == "" {
		return nil
	}
	seen := map[string]struct{}{}
	var tokens []string
	for _, token := range strings.Fields(normalized) {
		if len(token) == 1 && !keepShortToken[token] {
			continue
		}
		if queryStopwords[token] {
			continue
		}
		if _, ok := seen[token]; ok {
			continue
		}
		seen[token] = struct{}{}
		tokens = append(tokens, token)
	}
	return tokens
}

// NormalizeUnit canonicalizes dosage/volume unit strings.
func NormalizeUnit(unit string) string {
	switch NormalizeText(unit) {
	case "i u", "i j", "ij", "iu", "ije", "jm", "j m", "ie", "me":
		return "iu"
	case "μg", "µg", "mcg", "ug", "mikrogram", "mikrograma":
		return "mcg"
	case "gr", "gram", "grama":
		return "g"
	case "kg":
		return "kg"
	case "l", "litar", "litra":
		return "l"
	case "ml", "mililitar", "mililitra":
		return "ml"
	default:
		return NormalizeText(unit)
	}
}

// NormalizeForm canonicalizes a dosage-form word.
func NormalizeForm(form string) string {
	normalized := NormalizeText(form)
	if normalized == "" {
		return ""
	}
	if alias, ok := formAliases[normalized]; ok {
		return alias
	}
	return normalized
}

// ----------------------------------------------------------------------------
// Strength canonicalization
// ----------------------------------------------------------------------------

// canonicalStrength converts an extracted (value, unit) into a canonical key part
// and a human display string. Mass units collapse to a milligram base so that
// "5000 mcg" and "5 mg" group together; IU stays distinct. Vitamin D3 in mcg is
// converted to IU (1 mcg = 40 IU) so the dominant IU offers co-group.
func canonicalStrength(value float64, unit string, canonicals []string) (key string, display string) {
	unit = NormalizeUnit(unit)
	if value <= 0 || unit == "" {
		return "", ""
	}

	// Plausibility: vitamin D3/K2 are dosed in IU/mcg, never mg. A mg reading is a
	// mis-extraction (e.g. a co-ingredient's strength) — ignore it so the offer
	// falls into the unspecified-strength group instead of a junk "D3 500 MG" one.
	if unit == "mg" && (containsCanonical(canonicals, "vitamin d3") || containsCanonical(canonicals, "vitamin k2")) {
		return "", ""
	}

	baseVal, baseUnit := value, unit
	switch unit {
	case "mcg":
		if containsCanonical(canonicals, "vitamin d3") {
			baseVal, baseUnit = value*40, "iu"
		} else {
			baseVal, baseUnit = value/1000.0, "mg"
		}
	case "g":
		baseVal, baseUnit = value*1000.0, "mg"
	case "mg", "iu":
		// already canonical
	default:
		// unknown unit (e.g. %): keep as-is
	}

	baseVal = roundStrength(baseVal)
	if baseVal <= 0 {
		return "", ""
	}
	return formatCompactValue(baseVal) + baseUnit, formatDisplayMeasure(baseVal, baseUnit)
}

func containsCanonical(canonicals []string, target string) bool {
	for _, c := range canonicals {
		if c == target {
			return true
		}
	}
	return false
}

func roundStrength(v float64) float64 {
	return math.Round(v*1e6) / 1e6
}

func sizeKey(value float64, unit string) string {
	unit = NormalizeUnit(unit)
	if value <= 0 || unit == "" {
		return ""
	}
	switch unit {
	case "l":
		value, unit = value*1000.0, "ml"
	case "kg":
		value, unit = value*1000.0, "g"
	}
	// Powder weights are marketed loosely (908g vs 910g = 2lb; 2200g vs 2270g =
	// 5lb), so bucket grams: nearest 250g for tubs (>=500g), nearest 50g for mid
	// sizes, raw below 100g. Never bucket down to 0. Volumes (ml) are precise.
	if unit == "g" {
		switch {
		case value >= 500:
			value = math.Round(value/250.0) * 250.0
		case value >= 100:
			value = math.Round(value/50.0) * 50.0
		}
	}
	return formatCompactValue(roundStrength(value)) + unit
}

// ----------------------------------------------------------------------------
// Group key engine
// ----------------------------------------------------------------------------

// GroupKeyInput carries the per-offer fields used to compute its group.
type GroupKeyInput struct {
	Core        string
	Brand       string
	Title       string
	ProductID   string
	DosageValue float64
	DosageUnit  string
	VolumeValue float64
	VolumeUnit  string
	Quantity    float64
	Form        string
	// CanonicalIdentity, when set, is an LLM-canonicalized brand+line identity that
	// BuildGroupKey trusts verbatim (overrides the rule-derived core). Mined
	// per-brand for products the rules collapse to a bare brand.
	CanonicalIdentity string
}

// GroupKey is the result of grouping a single offer.
type GroupKey struct {
	Key         string // offers sharing this string belong to the same group
	DisplayName string
	Method      string // "ingredient" | "brand-line" | "brand-sku" | "single"
	Residual    string // Track-B residual identity (for the sizeless/sized merge pass)
	HasMeasure  bool   // a dosage or g/kg weight is present
}

// appendDisplaySuffix appends the human-readable distinguishers (strength, then size,
// then form) that are part of a brand-core group key, so two groups of the same line
// that differ only by those don't render as identical cards — e.g. "Fervex Phyto" syrup
// vs spray, or a protein line at 910 g vs 2.27 kg. Each piece is only added when present.
func appendDisplaySuffix(base string, in GroupKeyInput) string {
	if _, sDisp := canonicalStrength(in.DosageValue, in.DosageUnit, nil); sDisp != "" {
		base += " " + sDisp
	}
	if in.VolumeValue > 0 && in.VolumeUnit != "" {
		base += " " + formatDisplayMeasure(in.VolumeValue, NormalizeUnit(in.VolumeUnit))
	}
	if f := NormalizeForm(in.Form); f != "" {
		base += " " + titleCaseWords(f)
	}
	return base
}

// BuildGroupKey implements the grouping policy:
//
//	Track A (merge across brand / pack / form): the offer has a whitelisted
//	  supplement/OTC ingredient and a non-topical form. Key = ingredient(s) +
//	  canonical strength. This is the aggressive ingredient+strength merge.
//	Track B (brand SKU): everything else with an identifiable brand + descriptor.
//	  Key = brand + residual identity + strength + size + form, so identical SKUs
//	  merge across vendors but distinct products (and cross-category collisions
//	  like CoQ10 capsules vs Q10 face cream) never merge.
//	Singleton: no brand or no descriptor -> per-offer key, never merges.
func BuildGroupKey(in GroupKeyInput) GroupKey {
	core := strings.TrimSpace(in.Core)
	if core == "" {
		core = ExtractCoreFromTitle(in.Title)
	}

	// The attribute suffix (strength / size / form) used by the canonical-identity
	// and Track-B paths.
	suffix := func() []string {
		var parts []string
		if sKey, _ := canonicalStrength(in.DosageValue, in.DosageUnit, nil); sKey != "" {
			parts = append(parts, sKey)
		}
		if size := sizeKey(in.VolumeValue, in.VolumeUnit); size != "" {
			parts = append(parts, size)
		}
		if form := NormalizeForm(in.Form); form != "" {
			parts = append(parts, "form:"+form)
		}
		return parts
	}

	// LLM-canonicalized identity wins over EVERY rule-derived route — including the
	// Track-A ingredient merge below. It already encodes brand + line/stage/variant
	// consistently across vendors, so trust it verbatim (no noise-stripping that
	// would re-collapse e.g. "Kaltex Daily Stress Support" -> "Kaltex"). It must be
	// checked first: a probiotik whose core still carries an ingredient word
	// (taurin / menta / vitamin d3 / kolagen) would otherwise be bucketed into that
	// ingredient's brand-agnostic commodity group, lumping different makers' products
	// together. Only the size/strength suffix is appended so sizes stay distinct.
	if ci := NormalizeText(in.CanonicalIdentity); ci != "" {
		hm := in.DosageValue > 0 || NormalizeUnit(in.VolumeUnit) == "g" || NormalizeUnit(in.VolumeUnit) == "kg"
		parts := append([]string{"core", ci}, suffix()...)
		// Append the strength/size/form to the display so distinguished lines (a protein
		// line at 910 g vs 2.27 kg, or a syrup vs spray) don't render as identical cards.
		disp := appendDisplaySuffix(titleCaseWords(in.CanonicalIdentity), in)
		return GroupKey{Key: strings.Join(parts, "::"), DisplayName: disp, Method: "brand-core", Residual: ci, HasMeasure: hm}
	}

	// Decide whether this is a topical/cosmetic product (which must NOT merge into
	// an ingredient supplement group). The form field is empty for ~58% of rows, so
	// also scan the title for a topical-form word ("krema", "serum", "maska", ...);
	// and treat a formless liquid (ml container, no dosage) as topical too. Note:
	// only ML liquids — a weight (g/kg) is a powder (e.g. a protein tub), not a cream.
	mlUnit := func(u string) bool { n := NormalizeUnit(u); return n == "ml" || n == "l" }
	// A large gram weight (or any kg) is a powder/tub (protein, gainer), never a
	// cosmetic — so a "cream" word from a flavor name ("cookies & cream") must not
	// flag it as topical.
	isPowder := NormalizeUnit(in.VolumeUnit) == "kg" ||
		(NormalizeUnit(in.VolumeUnit) == "g" && in.VolumeValue >= powderMinGrams)
	topical := !isPowder && (IsTopicalForm(in.Form) ||
		HasTopicalToken(in.Title) ||
		IsCosmeticBrand(in.Brand) ||
		(in.Form == "" && in.VolumeValue > 0 && mlUnit(in.VolumeUnit) && in.DosageValue <= 0))

	suppl := SupplementIngredients(core)
	// A bare generic multivitamin is not an identity for a BRANDED / named product:
	// "Centrum Silver" / "Centrum Junior" must not collapse into the same group as
	// every other brand's multivitamin. If there's a brand or any extra identifying
	// token in the core, route it to the brand / core paths below instead.
	if len(suppl) == 1 && suppl[0] == "multivitamin" &&
		(NormalizeText(in.Brand) != "" || len(strings.Fields(NormalizeText(core))) > 1) {
		suppl = nil
	}
	if len(suppl) > 0 && !topical {
		canon := strings.Join(suppl, "+")
		key := "ing:" + canon
		display := displayIngredient(suppl)
		// Strength is only well-defined for a single ingredient. For combos the one
		// extracted dosage is ambiguous (which ingredient?), so group by the
		// ingredient set alone rather than attaching an arbitrary strength.
		if len(suppl) == 1 {
			if sKey, sDisp := canonicalStrength(in.DosageValue, in.DosageUnit, suppl); sKey != "" {
				key += "::" + sKey
				display += " " + sDisp
			}
		}
		// Form is part of the identity: tablets / capsules / spray / drops of the
		// same ingredient+strength are distinct products.
		if nf := NormalizeForm(in.Form); nf != "" {
			key += "::form:" + nf
			display += " " + nf
		}
		return GroupKey{Key: key, DisplayName: display, Method: "ingredient"}
	}

	// Track B. The attribute suffix (strength / size / form) is built by the suffix
	// closure defined near the top of the function.
	residual := residualCore(core)

	// Brand-INDEPENDENT line merge applies ONLY to measurable supplement/sports
	// products — a pharma dosage or a powder weight (g/kg). These are titled
	// inconsistently across vendors ("Iso Sensation 93" vs "Ultimate Nutrition Whey
	// Protein Iso Sensation"), so brand can't be in the key. A distinctive (>=2-token)
	// residual prevents generic words from merging. Devices / baby & personal care /
	// makeup have no such measure and fall through to the brand-keyed path below, so
	// different brands (breast pumps, toothbrushes, pads) never merge together.
	unit := NormalizeUnit(in.VolumeUnit)
	hasMeasure := in.DosageValue > 0 || unit == "g" || unit == "kg"
	if !topical && hasMeasure && len(strings.Fields(residual)) >= 2 {
		parts := append([]string{"prod", residual}, suffix()...)
		return GroupKey{Key: strings.Join(parts, "::"), DisplayName: buildSKUDisplay(in, residual), Method: "brand-line", Residual: residual, HasMeasure: true}
	}

	// Brand / name-anchored identity for NON-topical products: the core carries the
	// brand+line, which IS the product identity (Centrum Silver, Pregnacare
	// Original, Flonivin Forte, Osteocare). Unlike residualCore, identityCore KEEPS
	// the brand/name tokens, so single-product brands (Osteocare) group across
	// vendors, lines stay distinct (Silver vs Junior vs A-Z), and different brands
	// stay separate. Cosmetics are topical and fall through to the brand-sku path
	// below (brand kept separate from a descriptive residual).
	if !topical {
		identity := identityCore(core)
		// A single-token core below the generic-word length threshold is STILL a real
		// identity when it equals the product's own brand AND the product has a pharma
		// form (kapsule / tablete / sprej / kapi / sirup) — a short brand like "Ferin" /
		// "Liv" / "Autan" is then a single-product line, so every vendor's "Ferin 30
		// kapsula" groups instead of dropping to a per-offer singleton. The form gate is
		// what keeps this safe: multi-product COSMETIC / BABY / DEVICE brands (Aura makeup,
		// Nuk bottles, Hipp baby food, Elfi utensils) whose distinguishing token is stripped
		// as noise carry NO pharma form, so they stay separate instead of over-merging into
		// one bare-brand bucket.
		bareBrandLine := identity != "" && identity == NormalizeText(in.Brand) && NormalizeForm(in.Form) != ""
		if isDistinctiveCore(identity) || bareBrandLine {
			parts := append([]string{"core", identity}, suffix()...)
			// The form/size are part of the KEY (so a syrup, a spray and a lozenge of the
			// same line are distinct groups) — surface them in the DISPLAY too, otherwise
			// all three render as the identical card (e.g. three "Fervex Phyto").
			disp := appendDisplaySuffix(titleCaseWords(identity), in)
			return GroupKey{Key: strings.Join(parts, "::"), DisplayName: disp, Method: "brand-core", Residual: identity, HasMeasure: hasMeasure}
		}
	}

	// Brand-keyed SKU: cosmetics + branded goods (devices, baby care, makeup).
	// Different brands stay separate; identical brand+line+size+form merges across
	// vendors. Strip the product's OWN brand tokens from the residual so a
	// multi-word brand whose line token also survives in the core doesn't duplicate
	// in the key/display ("Vichy Dercos Dercos", "Esi Aloe Aloe Vera"). General fix
	// for all such brands — no per-brand list needed.
	if brand := NormalizeText(in.Brand); brand != "" && residual != "" {
		skuResidual := removeTokens(residual, strings.Fields(brand))
		parts := append([]string{"sku", brand, skuResidual}, suffix()...)
		return GroupKey{Key: strings.Join(parts, "::"), DisplayName: buildSKUDisplay(in, skuResidual), Method: "brand-sku", Residual: skuResidual, HasMeasure: hasMeasure}
	}

	display := titleCaseWords(residual)
	if display == "" {
		display = titleCaseWords(core)
	}
	if display == "" {
		display = strings.TrimSpace(in.Title)
	}
	// Per-offer key: never merges. Guard against an empty ProductID collapsing all
	// such offers into one bucket.
	offerID := in.ProductID
	if offerID == "" {
		offerID = NormalizeText(in.Title)
	}
	return GroupKey{Key: "offer:" + offerID, DisplayName: display, Method: "single", Residual: residual, HasMeasure: hasMeasure}
}

// isDistinctiveCore reports whether a residual is specific enough to safely group
// products by (rather than a generic word that could merge unrelated items). True
// for a multi-token residual, or a single token of >= 6 chars (a brand/product
// name like "centrum"), so generic short leftovers still fall to a per-offer key.
func isDistinctiveCore(residual string) bool {
	f := strings.Fields(residual)
	if len(f) >= 2 {
		return true
	}
	return len(f) == 1 && len([]rune(f[0])) >= 6
}

// residualSynonyms collapses spelling variants of non-whitelisted line words so
// the same product line doesn't split (e.g. casein / caseine / kazein).
var residualSynonyms = map[string]string{
	"caseine": "casein", "kazein": "casein", "kazeina": "casein",
	"micelarni": "micellar", "micelarna": "micellar",
	// Serbian/English (and typo) spellings of "isolate" — the SAME word — so a
	// protein line titled "... Izolat" and "... Isolate" don't split. (We keep
	// "isolate" as a meaningful token; we only unify its spelling, not strip it.)
	"izolat": "isolate", "izolata": "isolate", "izolatom": "isolate", "isolat": "isolate",
}

// residualCore reduces a core identity to its meaningful descriptor tokens
// (brand / noise / form / pack tokens removed), used for the Track-B SKU key.
func residualCore(core string) string {
	tokens := strings.Fields(NormalizeText(core))
	tokens = stripBrandTokens(tokens)
	out := make([]string, 0, len(tokens))
	for _, t := range tokens {
		if syn, ok := residualSynonyms[t]; ok {
			t = syn
		}
		if isNoiseWord(t) || isFormWord(t) {
			continue
		}
		if numberOnlyPattern.MatchString(t) {
			continue
		}
		if alphaNumPattern.MatchString(t) {
			continue
		}
		if len(t) < 2 && !keepShortToken[t] {
			continue
		}
		out = append(out, t)
		if len(out) >= 4 {
			break
		}
	}
	return strings.Join(out, " ")
}

// identityCore reduces a core to its identifying tokens but KEEPS brand/name
// tokens (unlike residualCore, which strips them). Used for the brand-identity
// path where the brand IS the product identity: "Pregnacare Original" must stay
// "pregnacare original" (not collapse to "original"), and "Osteocare" must stay
// "osteocare" (not become an empty residual -> per-offer singleton).
// removeTokens drops every token in `drop` from the space-separated phrase,
// preserving order of the remaining tokens.
func removeTokens(phrase string, drop []string) string {
	if phrase == "" || len(drop) == 0 {
		return phrase
	}
	ds := make(map[string]bool, len(drop))
	for _, d := range drop {
		ds[d] = true
	}
	out := make([]string, 0, len(strings.Fields(phrase)))
	for _, t := range strings.Fields(phrase) {
		if !ds[t] {
			out = append(out, t)
		}
	}
	return strings.Join(out, " ")
}

func identityCore(core string) string {
	tokens := strings.Fields(NormalizeText(core))
	out := make([]string, 0, len(tokens))
	for _, t := range tokens {
		if syn, ok := residualSynonyms[t]; ok {
			t = syn
		}
		if isNoiseWord(t) || isFormWord(t) {
			continue
		}
		if numberOnlyPattern.MatchString(t) {
			continue
		}
		if alphaNumPattern.MatchString(t) {
			continue
		}
		if len(t) < 2 && !keepShortToken[t] {
			continue
		}
		out = append(out, t)
		if len(out) >= 5 {
			break
		}
	}
	return strings.Join(out, " ")
}

func displayIngredient(canonicals []string) string {
	parts := make([]string, 0, len(canonicals))
	for _, c := range canonicals {
		parts = append(parts, titleCaseWords(c))
	}
	return strings.Join(parts, " + ")
}

func buildSKUDisplay(in GroupKeyInput, residual string) string {
	parts := []string{}
	if b := strings.TrimSpace(in.Brand); b != "" {
		parts = append(parts, titleCaseWords(b))
	}
	if residual != "" {
		parts = append(parts, titleCaseWords(residual))
	}
	if _, sDisp := canonicalStrength(in.DosageValue, in.DosageUnit, nil); sDisp != "" {
		parts = append(parts, sDisp)
	}
	if in.VolumeValue > 0 && in.VolumeUnit != "" {
		parts = append(parts, formatDisplayMeasure(in.VolumeValue, NormalizeUnit(in.VolumeUnit)))
	}
	if form := NormalizeForm(in.Form); form != "" {
		parts = append(parts, form)
	}
	if len(parts) == 0 {
		return strings.TrimSpace(in.Title)
	}
	return strings.Join(parts, " ")
}

// titleCaseWords capitalizes words for display, upper-casing alphanumeric codes
// (d3, b12, q10, mk7) and pure numbers, leaving the rest Title Cased.
func titleCaseWords(text string) string {
	fields := strings.Fields(text)
	out := make([]string, 0, len(fields))
	for _, w := range fields {
		hasDigit := strings.IndexFunc(w, unicode.IsDigit) >= 0
		hasLetter := strings.IndexFunc(w, unicode.IsLetter) >= 0
		switch {
		case hasDigit && hasLetter:
			out = append(out, strings.ToUpper(w))
		case hasDigit:
			out = append(out, w)
		default:
			out = append(out, strings.ToUpper(w[:1])+w[1:])
		}
	}
	return strings.Join(out, " ")
}

// ----------------------------------------------------------------------------
// Search query expansion
// ----------------------------------------------------------------------------

// SearchConcepts turns a raw query into:
//
//	required: the set of "concept tokens" a product must contain (AND semantics).
//	          Ingredient mentions become a compact canonical token (e.g. "vitaminc",
//	          "magnezijum") so Serbian/English/abbreviation spellings unify.
//	variants: alias phrases for substring (ILIKE) recall on core/normalized name.
func SearchConcepts(query string) (required []string, variants []string) {
	canon, leftover := analyzeWithFuzzy(query)

	reqSet := map[string]struct{}{}
	varSet := map[string]struct{}{}
	add := func(set map[string]struct{}, v string) {
		if v != "" {
			set[v] = struct{}{}
		}
	}

	for _, c := range canon {
		add(reqSet, strings.ReplaceAll(c, " ", ""))
		add(varSet, c)
		for _, a := range AliasesFor(c) {
			add(varSet, a)
		}
	}
	for _, t := range leftover {
		if queryStopwords[t] {
			continue
		}
		if len(t) == 1 && !keepShortToken[t] {
			continue
		}
		add(reqSet, t)
	}

	for k := range reqSet {
		required = append(required, k)
	}
	for k := range varSet {
		variants = append(variants, k)
	}
	sort.Strings(required)
	sort.Strings(variants)
	return required, variants
}

// ExpandQueryVariants returns alias/spelling variants of a query for scoring and
// loose matching.
func ExpandQueryVariants(query string) []string {
	normalized := NormalizeText(query)
	if normalized == "" {
		return nil
	}
	seen := map[string]struct{}{}
	add := func(v string) {
		if v = NormalizeText(v); v != "" {
			seen[v] = struct{}{}
		}
	}
	add(normalized)
	add(strings.ReplaceAll(normalized, " ", ""))

	canon, _ := analyzeWithFuzzy(normalized)
	for _, c := range canon {
		add(c)
		add(strings.ReplaceAll(c, " ", ""))
		for _, a := range AliasesFor(c) {
			add(a)
		}
	}

	variants := make([]string, 0, len(seen))
	for v := range seen {
		variants = append(variants, v)
	}
	sort.Strings(variants)
	return variants
}

// ----------------------------------------------------------------------------
// Fallback core extraction (used when stored core is empty)
// ----------------------------------------------------------------------------

var (
	fallbackDosageRE = regexp.MustCompile(`(?i)\b\d+(?:[.,]\d+)?\s*(mg|mcg|ug|μg|µg|iu|ij|i\.?u\.?|i\.?j\.?|ml|l|g|gr|kg|%)\b`)
	fallbackQtyRE    = regexp.MustCompile(`(?i)\b[axх×]?\d+\s*(mikrotablet\w*|tab\w*|tabl\w*|kaps\w*|caps\w*|softgel\w*|kom\w*|kesic\w*|ampul\w*|kapi)\b`)
	fallbackPackRE   = regexp.MustCompile(`(?i)\b[axх×]\d+\b|\b\d+[xх×]\b`)
)

// ExtractCoreFromTitle is a best-effort identity extractor for titles without a
// precomputed core. It strips dosage/quantity/brand/noise and keeps the first few
// descriptor tokens.
func ExtractCoreFromTitle(title string) string {
	t := strings.ToLower(title)
	t = fallbackDosageRE.ReplaceAllString(t, " ")
	t = fallbackQtyRE.ReplaceAllString(t, " ")
	t = fallbackPackRE.ReplaceAllString(t, " ")
	norm := NormalizeText(t)
	if norm == "" {
		return ""
	}
	tokens := stripBrandTokens(strings.Fields(norm))
	out := make([]string, 0, 4)
	for _, w := range tokens {
		if isNoiseWord(w) || isFormWord(w) {
			continue
		}
		if numberOnlyPattern.MatchString(w) || alphaNumPattern.MatchString(w) {
			continue
		}
		if len(w) < 2 && !keepShortToken[w] {
			continue
		}
		out = append(out, w)
		if len(out) >= 4 {
			break
		}
	}
	return strings.Join(out, " ")
}

func formatCompactValue(value float64) string {
	if value == math.Trunc(value) {
		return fmt.Sprintf("%d", int(value))
	}
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func formatDisplayMeasure(value float64, unit string) string {
	display := strings.ToUpper(NormalizeUnit(unit))
	if value == math.Trunc(value) {
		return fmt.Sprintf("%d %s", int(value), display)
	}
	return fmt.Sprintf("%s %s", formatCompactValue(value), display)
}
