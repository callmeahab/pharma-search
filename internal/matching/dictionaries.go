package matching

import (
	_ "embed"
	"encoding/json"
	"log"
	"sort"
	"strings"
)

//go:embed data/ingredients.json
var ingredientsJSON []byte

//go:embed data/brands.json
var brandsJSON []byte

//go:embed data/stopwords.json
var stopwordsJSON []byte

type ingredientEntry struct {
	Canonical string   `json:"canonical"`
	Category  string   `json:"category"`
	Aliases   []string `json:"aliases"`
}

type aliasEntry struct {
	canonical string
	category  string
	nTokens   int
}

type fuzzyAlias struct {
	alias     string
	canonical string
}

var (
	// aliasIndex maps a normalized alias phrase -> its canonical ingredient.
	aliasIndex = map[string]aliasEntry{}
	// canonicalCategory maps canonical ingredient -> category.
	canonicalCategory = map[string]string{}
	// canonicalAliases maps canonical -> all alias phrases (for query expansion).
	canonicalAliases = map[string][]string{}
	maxAliasTokens   = 1

	brandStrip     = map[string]bool{}
	brandKeep      = map[string]bool{}
	cosmeticBrands = map[string]bool{}
	noiseWords     = map[string]bool{}
	formWords      = map[string]bool{}

	// Alias phrases (len>=5) for typo-tolerant resolution. fuzzyTokenAliases are
	// single-token (e.g. "magnezijum"); fuzzyPhraseAliases include multi-word
	// (e.g. "vitamin c") for whole-query typos ("vitmin c").
	fuzzyTokenAliases  []fuzzyAlias
	fuzzyPhraseAliases []fuzzyAlias

	// Track-A categories: products keyed by ingredient + strength.
	trackACategory = map[string]bool{"supplement": true, "otc-drug": true, "otc": true, "drug": true}
)

// Definitively topical / cosmetic forms. A product with a whitelisted ingredient
// but one of these forms is NOT auto-merged by ingredient (it is a cosmetic, e.g.
// "Vitamin C serum", "Q10 krema"), it goes to the brand-SKU track instead.
var topicalForms = map[string]bool{
	"krema": true, "krem": true, "gel": true, "serum": true, "losion": true,
	"mast": true, "sampon": true, "balzam": true, "sapun": true, "maska": true,
	"pena": true, "puder": true, "lak": true, "ruz": true, "tonik": true,
	"mleko": true, "mlijeko": true, "emulzija": true, "fluid": true, "pasta": true,
	"dezodorans": true, "parfem": true, "edt": true, "edp": true, "kupka": true,
	"micelarna": true, "voda": true, "scrub": true, "piling": true, "melem": true,
	// Hygiene / personal-care / non-ingestible forms — keep wipes, pads,
	// suppositories, toilet paper, pacifiers, cotton buds out of ingredient groups.
	"maramice": true, "maramica": true, "ulosci": true, "ulozak": true, "ulozaka": true,
	"jastucici": true, "jastucic": true, "vagitorije": true, "vaginalete": true,
	"vaginaleta": true, "supozitorije": true, "supozitorija": true, "patrona": true,
	"patrone": true, "papir": true, "duda": true, "dude": true, "dudica": true,
	"cucla": true, "cucle": true, "stapici": true, "tampon": true, "tamponi": true,
	"traka": true, "trake": true, "vosak": true, "stik": true, "roll": true,
	// Cosmetic descriptor signals (day/night/anti-aging) — many face creams omit
	// the word "krema" entirely (e.g. "Nivea Q10 noćna 50g").
	"nocna": true, "dnevna": true, "bora": true, "falten": true, "antiageing": true,
	"highlighter": true, "korektor": true, "maskara": true,
}

func init() {
	loadDictionaries()
}

func loadDictionaries() {
	var ingDoc struct {
		Ingredients []ingredientEntry `json:"ingredients"`
	}
	if err := json.Unmarshal(ingredientsJSON, &ingDoc); err != nil {
		log.Printf("matching: failed to parse ingredients.json: %v", err)
	}
	for _, e := range ingDoc.Ingredients {
		canon := NormalizeText(e.Canonical)
		if canon == "" {
			continue
		}
		canonicalCategory[canon] = e.Category
		for _, alias := range e.Aliases {
			a := NormalizeText(alias)
			if a == "" {
				continue
			}
			n := len(strings.Fields(a))
			if n > maxAliasTokens {
				maxAliasTokens = n
			}
			// Longer / earlier alias wins ties deterministically; first writer keeps it.
			if _, exists := aliasIndex[a]; !exists {
				aliasIndex[a] = aliasEntry{canonical: canon, category: e.Category, nTokens: n}
			}
			canonicalAliases[canon] = append(canonicalAliases[canon], a)
			if len(a) >= 5 {
				fuzzyPhraseAliases = append(fuzzyPhraseAliases, fuzzyAlias{a, canon})
				if n == 1 {
					fuzzyTokenAliases = append(fuzzyTokenAliases, fuzzyAlias{a, canon})
				}
			}
		}
	}

	var brandDoc struct {
		Strip    []string `json:"strip"`
		Keep     []string `json:"keep"`
		Cosmetic []string `json:"cosmetic"`
	}
	if err := json.Unmarshal(brandsJSON, &brandDoc); err != nil {
		log.Printf("matching: failed to parse brands.json: %v", err)
	}
	for _, b := range brandDoc.Strip {
		if n := NormalizeText(b); n != "" {
			brandStrip[n] = true
		}
	}
	for _, b := range brandDoc.Keep {
		if n := NormalizeText(b); n != "" {
			brandKeep[n] = true
		}
	}
	for _, b := range brandDoc.Cosmetic {
		if n := NormalizeText(b); n != "" {
			cosmeticBrands[n] = true
		}
	}

	var stopDoc struct {
		Noise []string `json:"noise"`
		Forms []string `json:"forms"`
	}
	if err := json.Unmarshal(stopwordsJSON, &stopDoc); err != nil {
		log.Printf("matching: failed to parse stopwords.json: %v", err)
	}
	for _, w := range stopDoc.Noise {
		if n := NormalizeText(w); n != "" {
			noiseWords[n] = true
		}
	}
	for _, w := range stopDoc.Forms {
		if n := NormalizeText(w); n != "" {
			formWords[n] = true
		}
	}
}

// analyzeIngredients finds whitelisted canonical ingredients present in text using
// longest-alias-first token matching. When trackAOnly is set, only supplement/OTC
// ingredients are considered. Returns the sorted de-duplicated canonicals plus the
// leftover tokens (those not consumed by any matched ingredient alias).
func analyzeIngredients(text string, trackAOnly bool) (canonicals []string, leftover []string) {
	tokens := strings.Fields(NormalizeText(text))
	if len(tokens) == 0 {
		return nil, nil
	}

	used := make([]bool, len(tokens))
	found := map[string]struct{}{}

	for i := 0; i < len(tokens); i++ {
		if used[i] {
			continue
		}
		maxN := maxAliasTokens
		if remaining := len(tokens) - i; maxN > remaining {
			maxN = remaining
		}
		for n := maxN; n >= 1; n-- {
			phrase := strings.Join(tokens[i:i+n], " ")
			entry, ok := aliasIndex[phrase]
			if !ok {
				continue
			}
			if trackAOnly && !trackACategory[entry.category] {
				continue
			}
			found[entry.canonical] = struct{}{}
			for k := i; k < i+n; k++ {
				used[k] = true
			}
			i += n - 1
			break
		}
	}

	for i, t := range tokens {
		if !used[i] {
			leftover = append(leftover, t)
		}
	}

	if len(found) > 0 {
		canonicals = make([]string, 0, len(found))
		for c := range found {
			canonicals = append(canonicals, c)
		}
		sort.Strings(canonicals)
	}
	return canonicals, leftover
}

// SupplementIngredients returns the sorted supplement/OTC canonical ingredients
// detected in text (the Track-A identity).
func SupplementIngredients(text string) []string {
	canon, _ := analyzeIngredients(text, true)
	return canon
}

// CanonicalIngredients returns all whitelisted canonical ingredients (any
// category) detected in text.
func CanonicalIngredients(text string) []string {
	canon, _ := analyzeIngredients(text, false)
	return canon
}

// AliasesFor returns all known alias phrases for a canonical ingredient.
func AliasesFor(canonical string) []string {
	return canonicalAliases[NormalizeText(canonical)]
}

// IsTopicalForm reports whether the normalized form is a definitively cosmetic
// (non-ingestible) form.
func IsTopicalForm(form string) bool {
	return topicalForms[NormalizeText(form)]
}

// IsCosmeticBrand reports whether the brand is a known pure-cosmetic manufacturer
// (so its products are cosmetics, not supplements, even without a form word).
func IsCosmeticBrand(brand string) bool {
	return cosmeticBrands[NormalizeText(brand)]
}

// HasTopicalToken reports whether any token in the text is a topical/cosmetic
// form word. Used to detect cosmetics whose `form` field is empty but whose title
// makes clear they are topical (e.g. "Eucerin Q10 krema za lice").
func HasTopicalToken(text string) bool {
	for _, t := range strings.Fields(NormalizeText(text)) {
		if topicalForms[t] {
			return true
		}
	}
	return false
}

// StripBrandTokens removes known brand tokens from a normalized token slice,
// keeping any token that is also a protected ingredient identity word.
func stripBrandTokens(tokens []string) []string {
	out := tokens[:0:0]
	for _, t := range tokens {
		if brandStrip[t] && !brandKeep[t] {
			continue
		}
		out = append(out, t)
	}
	return out
}

func isNoiseWord(token string) bool { return noiseWords[token] }
func isFormWord(token string) bool  { return formWords[token] }

// fuzzyMaxDist is the allowed edit distance for a string of length n.
func fuzzyMaxDist(n int) int {
	if n >= 10 {
		return 2
	}
	return 1
}

// fuzzyCanonicalFrom returns the canonical of the closest alias in the candidate
// list within the edit-distance budget, or "" if none.
func fuzzyCanonicalFrom(s string, candidates []fuzzyAlias) string {
	n := len(s)
	if n < 5 {
		return ""
	}
	maxDist := fuzzyMaxDist(n)
	best, bestDist := "", maxDist+1
	for _, fa := range candidates {
		if d := len(fa.alias) - n; d > maxDist || -d > maxDist {
			continue
		}
		if fa.alias == s {
			return fa.canonical // exact (cheap short-circuit)
		}
		dist := boundedLevenshtein(s, fa.alias, maxDist)
		if dist < bestDist {
			bestDist, best = dist, fa.canonical
		}
	}
	if bestDist <= maxDist {
		return best
	}
	return ""
}

// analyzeWithFuzzy is analyzeIngredients plus typo tolerance: leftover tokens are
// fuzzy-matched to single-token ingredient aliases, and a short whole query that
// found no ingredient is fuzzy-matched against full alias phrases.
func analyzeWithFuzzy(query string) (canon []string, leftover []string) {
	norm := NormalizeText(query)
	canon, leftover = analyzeIngredients(norm, false)

	if len(leftover) > 0 {
		seen := map[string]bool{}
		for _, c := range canon {
			seen[c] = true
		}
		var rest []string
		for _, t := range leftover {
			if c := fuzzyCanonicalFrom(t, fuzzyTokenAliases); c != "" {
				if !seen[c] {
					canon = append(canon, c)
					seen[c] = true
				}
				continue
			}
			rest = append(rest, t)
		}
		leftover = rest
		sort.Strings(canon)
	}

	if len(canon) == 0 {
		if toks := strings.Fields(norm); len(toks) >= 1 && len(toks) <= 3 {
			if c := fuzzyCanonicalFrom(norm, fuzzyPhraseAliases); c != "" {
				canon, leftover = []string{c}, nil
			}
		}
	}
	return canon, leftover
}

// boundedLevenshtein returns the edit distance between a and b, capped at max+1
// (returns max+1 as soon as the whole row exceeds max).
func boundedLevenshtein(a, b string, max int) int {
	la, lb := len(a), len(b)
	if la == 0 {
		return lb
	}
	if lb == 0 {
		return la
	}
	prev := make([]int, lb+1)
	curr := make([]int, lb+1)
	for j := 0; j <= lb; j++ {
		prev[j] = j
	}
	for i := 1; i <= la; i++ {
		curr[0] = i
		rowMin := curr[0]
		for j := 1; j <= lb; j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			del, ins, sub := prev[j]+1, curr[j-1]+1, prev[j-1]+cost
			m := del
			if ins < m {
				m = ins
			}
			if sub < m {
				m = sub
			}
			curr[j] = m
			if m < rowMin {
				rowMin = m
			}
		}
		if rowMin > max {
			return max + 1
		}
		prev, curr = curr, prev
	}
	return prev[lb]
}
