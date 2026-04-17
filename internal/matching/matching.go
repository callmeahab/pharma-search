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

var (
	serbianTextReplacer = strings.NewReplacer(
		"đ", "dj",
		"Đ", "dj",
		"č", "c",
		"Č", "c",
		"ć", "c",
		"Ć", "c",
		"š", "s",
		"Š", "s",
		"ž", "z",
		"Ž", "z",
		"љ", "lj",
		"Љ", "lj",
		"њ", "nj",
		"Њ", "nj",
		"џ", "dz",
		"Џ", "dz",
		"ђ", "dj",
		"Ђ", "dj",
		"ј", "j",
		"Ј", "j",
		"ч", "c",
		"Ч", "c",
		"ћ", "c",
		"Ћ", "c",
		"ш", "s",
		"Ш", "s",
		"ж", "z",
		"Ж", "z",
		"а", "a",
		"А", "a",
		"б", "b",
		"Б", "b",
		"в", "v",
		"В", "v",
		"г", "g",
		"Г", "g",
		"д", "d",
		"Д", "d",
		"е", "e",
		"Е", "e",
		"з", "z",
		"З", "z",
		"и", "i",
		"И", "i",
		"к", "k",
		"К", "k",
		"л", "l",
		"Л", "l",
		"м", "m",
		"М", "m",
		"н", "n",
		"Н", "n",
		"о", "o",
		"О", "o",
		"п", "p",
		"П", "p",
		"р", "r",
		"Р", "r",
		"с", "s",
		"С", "s",
		"т", "t",
		"Т", "t",
		"у", "u",
		"У", "u",
		"ф", "f",
		"Ф", "f",
		"х", "h",
		"Х", "h",
		"ц", "c",
		"Ц", "c",
	)

	pharmaDosagePattern   = regexp.MustCompile(`(?i)\b(\d+(?:[.,]\d+)?)\s*(mg|mcg|μg|µg|iu|i\.u\.|i\.j\.|ij)\b`)
	gramPattern           = regexp.MustCompile(`(?i)\b(\d+(?:[.,]\d+)?)\s*(g|gr|gram|grama)\b`)
	quantityPattern       = regexp.MustCompile(`\b[ax]?(\d+)\s*(mikrotablet|mikrokapsul|tab|tabl|tableta|tablete|kaps|kapsula|kapsule|caps|capsule|softgel|gel|komada|kom)\w*\b`)
	quantitySuffixPattern = regexp.MustCompile(`\b[ax](\d+)\b`)
	alphaNumPattern       = regexp.MustCompile(`^\d+[a-z]+$|^[a-z]+\d+$`)
)

var queryExpansions = map[string]string{
	"vitc":   "vitamin c",
	"vitd":   "vitamin d",
	"vitb":   "vitamin b",
	"vit":    "vitamin",
	"d3":     "vitamin d3",
	"b12":    "vitamin b12",
	"k2":     "vitamin k2",
	"calc":   "calcium",
	"mag":    "magnesium",
	"zn":     "zinc",
	"fe":     "iron",
	"prob":   "probiotic",
	"omega3": "omega 3",
	"coq10":  "coenzyme q10",
	"bcaa":   "branched chain amino acids",
}

var formAliases = map[string]string{
	"tab":        "tablete",
	"tabl":       "tablete",
	"tableta":    "tablete",
	"tablete":    "tablete",
	"kaps":       "kapsule",
	"kapsula":    "kapsule",
	"kapsule":    "kapsule",
	"caps":       "kapsule",
	"capsule":    "kapsule",
	"capsules":   "kapsule",
	"softgel":    "kapsule",
	"softgels":   "kapsule",
	"cps":        "kapsule",
	"sirup":      "sirup",
	"sprej":      "sprej",
	"spray":      "sprej",
	"kapi":       "kapi",
	"drops":      "kapi",
	"gel":        "gel",
	"gela":       "gel",
	"krema":      "krema",
	"krem":       "krema",
	"cream":      "krema",
	"mast":       "mast",
	"ointment":   "mast",
	"losion":     "losion",
	"lotion":     "losion",
	"serum":      "serum",
	"rastvor":    "rastvor",
	"solution":   "rastvor",
	"suspenzija": "suspenzija",
	"kesica":     "kesice",
	"kesice":     "kesice",
	"ampula":     "ampule",
	"ampule":     "ampule",
	"prah":       "prah",
	"powder":     "prah",
}

var skipWords = map[string]bool{
	"a": true, "za": true, "i": true, "sa": true, "od": true, "u": true,
	"the": true, "of": true, "with": true, "and": true, "for": true,
	"kapsule": true, "kapsula": true, "tablete": true, "tableta": true,
	"mikrotablete": true, "mikrotableta": true, "mikrokapsule": true,
	"softgel": true, "soft": true, "gel": true, "caps": true, "tab": true, "tbl": true,
	"iu": true, "mg": true, "ml": true, "mcg": true, "g": true,
	"sprej": true, "oral": true, "kapi": true, "sirup": true,
}

var brandWords = map[string]bool{
	"esi": true, "now": true, "vitabiotics": true, "terranova": true,
	"bivits": true, "activa": true, "masterteh": true, "multi": true,
	"essence": true, "food": true, "ultra": true, "plus": true,
	"detrical": true, "videtril": true, "nutrition": true,
}

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

func Tokenize(text string) []string {
	normalized := NormalizeText(text)
	if normalized == "" {
		return nil
	}

	seen := map[string]struct{}{}
	var tokens []string
	for _, token := range strings.Fields(normalized) {
		if len(token) == 1 && token != "d" && token != "b" && token != "c" && token != "k" {
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

func ExpandQueryVariants(query string) []string {
	normalized := NormalizeText(query)
	if normalized == "" {
		return nil
	}

	seen := map[string]struct{}{}
	add := func(value string) {
		value = NormalizeText(value)
		if value == "" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
	}

	add(normalized)
	add(strings.ReplaceAll(normalized, " ", ""))

	if expanded, ok := queryExpansions[normalized]; ok {
		add(expanded)
	}

	tokens := strings.Fields(normalized)
	for _, token := range tokens {
		if expanded, ok := queryExpansions[token]; ok {
			add(expanded)
		}
	}

	if len(tokens) == 2 && (tokens[0] == "vit" || tokens[0] == "vitamin") {
		add("vitamin " + tokens[1])
	}
	if len(tokens) == 2 && tokens[0] == "omega" {
		add("omega " + tokens[1])
		add("omega" + tokens[1])
	}

	var variants []string
	for variant := range seen {
		variants = append(variants, variant)
	}
	sort.Strings(variants)
	return variants
}

func NormalizeUnit(unit string) string {
	switch NormalizeText(unit) {
	case "i u", "i j", "ij", "iu":
		return "iu"
	case "μg", "µg", "mcg":
		return "mcg"
	case "gr", "gram", "grama":
		return "g"
	default:
		return NormalizeText(unit)
	}
}

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

func BuildGroupID(coreIdentity string, dosageValue float64, dosageUnit string) string {
	coreIdentity = NormalizeText(coreIdentity)
	if coreIdentity == "" {
		return ""
	}

	parts := []string{coreIdentity}
	if dosageValue > 0 && dosageUnit != "" {
		parts = append(parts, "dose:"+formatCompactValue(dosageValue)+NormalizeUnit(dosageUnit))
	}

	return strings.Join(parts, "::")
}

func BuildComparableGroupID(coreIdentity string, dosageValue float64, dosageUnit string, volumeValue float64, volumeUnit string, quantityValue float64, form string) string {
	coreIdentity = NormalizeText(coreIdentity)
	if coreIdentity == "" {
		return ""
	}

	parts := []string{coreIdentity}
	if dosageValue > 0 && dosageUnit != "" {
		parts = append(parts, "dose:"+formatCompactValue(dosageValue)+NormalizeUnit(dosageUnit))
	}
	if volumeValue > 0 && volumeUnit != "" {
		parts = append(parts, "vol:"+formatCompactValue(volumeValue)+NormalizeUnit(volumeUnit))
	}
	if quantityValue > 0 {
		parts = append(parts, fmt.Sprintf("qty:%d", int(quantityValue)))
	}
	if normalizedForm := NormalizeForm(form); normalizedForm != "" {
		parts = append(parts, "form:"+normalizedForm)
	}

	return strings.Join(parts, "::")
}

func BuildDisplayName(coreIdentity string, dosageValue float64, dosageUnit string, volumeValue float64, volumeUnit string, quantityValue float64, form string) string {
	coreIdentity = strings.TrimSpace(coreIdentity)
	if coreIdentity == "" {
		return ""
	}

	parts := []string{coreIdentity}
	if dosageValue > 0 && dosageUnit != "" {
		parts = append(parts, formatDisplayMeasure(dosageValue, dosageUnit))
	}
	if volumeValue > 0 && volumeUnit != "" {
		parts = append(parts, formatDisplayMeasure(volumeValue, volumeUnit))
	}

	normalizedForm := NormalizeForm(form)
	if quantityValue > 0 {
		if normalizedForm != "" {
			parts = append(parts, fmt.Sprintf("%d %s", int(quantityValue), normalizedForm))
		} else {
			parts = append(parts, fmt.Sprintf("x%d", int(quantityValue)))
		}
	} else if normalizedForm != "" {
		parts = append(parts, normalizedForm)
	}

	return strings.Join(parts, " ")
}

func ExtractGroupKey(title string) string {
	t := strings.ToLower(title)

	noise := []string{"®", "™", "©", ",", "(", ")", "[", "]", "/", "\\", "_", "-", "–", "—"}
	for _, n := range noise {
		t = strings.ReplaceAll(t, n, " ")
	}
	t = strings.Join(strings.Fields(t), " ")

	dosage := ""
	dosageMatch := ""
	if match := pharmaDosagePattern.FindStringSubmatch(t); len(match) >= 3 {
		amount := match[1]
		unit := NormalizeUnit(match[2])
		dosageMatch = match[0]
		dosage = amount + " " + unit
	} else if match := gramPattern.FindStringSubmatch(t); len(match) >= 3 {
		amount := match[1]
		val, _ := strconv.ParseFloat(strings.Replace(amount, ",", ".", 1), 64)
		if val <= 5.0 {
			dosageMatch = match[0]
			dosage = amount + " g"
		}
	}

	quantity := ""
	quantityMatch := ""
	if match := quantityPattern.FindStringSubmatch(t); len(match) >= 2 {
		quantity = match[1]
		quantityMatch = match[0]
	} else if match := quantitySuffixPattern.FindStringSubmatch(t); len(match) >= 2 {
		quantity = match[1]
		quantityMatch = match[0]
	}

	ingredientPart := t
	if dosageMatch != "" {
		ingredientPart = strings.Replace(ingredientPart, dosageMatch, " ", 1)
	}
	if quantityMatch != "" {
		ingredientPart = strings.Replace(ingredientPart, quantityMatch, " ", 1)
	}
	ingredientPart = strings.Join(strings.Fields(ingredientPart), " ")

	words := strings.Fields(ingredientPart)
	coreWords := make([]string, 0, 4)
	for _, w := range words {
		if skipWords[w] || brandWords[w] {
			continue
		}

		isAfterVitaminOrOmega := len(coreWords) > 0 &&
			(coreWords[len(coreWords)-1] == "vitamin" || coreWords[len(coreWords)-1] == "omega")

		if _, err := strconv.Atoi(w); err == nil && !isAfterVitaminOrOmega {
			continue
		}

		if alphaNumPattern.MatchString(w) && !(isAfterVitaminOrOmega && len(w) <= 3) {
			continue
		}

		if len(w) < 2 && !isAfterVitaminOrOmega {
			continue
		}

		coreWords = append(coreWords, w)
		if len(coreWords) >= 3 {
			break
		}
	}

	ingredient := strings.Join(coreWords, " ")

	var parts []string
	if ingredient != "" {
		parts = append(parts, ingredient)
	}
	if dosage != "" {
		parts = append(parts, dosage)
	}
	if quantity != "" {
		parts = append(parts, "x"+quantity)
	}

	if len(parts) > 0 {
		return strings.Join(parts, " ")
	}
	if len(t) > 30 {
		return t[:30]
	}
	return t
}

func formatCompactValue(value float64) string {
	if value == math.Trunc(value) {
		return fmt.Sprintf("%d", int(value))
	}
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func formatDisplayMeasure(value float64, unit string) string {
	if value == math.Trunc(value) {
		return fmt.Sprintf("%d %s", int(value), strings.ToUpper(NormalizeUnit(unit)))
	}
	return fmt.Sprintf("%s %s", formatCompactValue(value), strings.ToUpper(NormalizeUnit(unit)))
}
