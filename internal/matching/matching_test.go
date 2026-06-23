package matching

import (
	"reflect"
	"strings"
	"testing"
)

func TestNormalizeText(t *testing.T) {
	got := NormalizeText("Čaj protiv кашља 200ML")
	want := "caj protiv kaslja 200ml"
	if got != want {
		t.Fatalf("NormalizeText() = %q, want %q", got, want)
	}
}

func TestSupplementIngredientsDetectsAliasesAndCombos(t *testing.T) {
	cases := []struct {
		text string
		want []string
	}{
		{"NOW Vitamin D3 2000IU 60 kapsula", []string{"vitamin d3"}},
		{"Solgar Magnesium Citrate 200mg", []string{"magnezijum"}},
		{"d3", []string{"vitamin d3"}},
		{"Magnezijum + B6 30 tableta", []string{"magnezijum", "vitamin b6"}},
		{"Bioderma Sensibio micelarna voda", nil},
	}
	for _, c := range cases {
		if got := SupplementIngredients(c.text); !reflect.DeepEqual(got, c.want) {
			t.Errorf("SupplementIngredients(%q) = %v, want %v", c.text, got, c.want)
		}
	}
}

func TestBuildGroupKeyTrackAMergesAcrossBrandAndPackButNotForm(t *testing.T) {
	// Same ingredient + strength + form, different brand & pack -> one group.
	a := BuildGroupKey(GroupKeyInput{Core: "Vitamin D3", Brand: "NOW", DosageValue: 2000, DosageUnit: "iu", Quantity: 60, Form: "kapsule", ProductID: "1"})
	b := BuildGroupKey(GroupKeyInput{Core: "Vitamin D3", Brand: "Solgar", DosageValue: 2000, DosageUnit: "iu", Quantity: 30, Form: "kaps", ProductID: "2"})
	if a.Key != b.Key {
		t.Fatalf("expected same key across brand/pack, got %q vs %q", a.Key, b.Key)
	}
	if a.Method != "ingredient" {
		t.Fatalf("expected method 'ingredient', got %q", a.Method)
	}
	if a.DisplayName != "Vitamin D3 2000 IU kapsule" {
		t.Fatalf("unexpected display name %q", a.DisplayName)
	}
	// Different form -> different group.
	c := BuildGroupKey(GroupKeyInput{Core: "Vitamin D3", Brand: "NOW", DosageValue: 2000, DosageUnit: "iu", Form: "tablete", ProductID: "3"})
	if a.Key == c.Key {
		t.Fatalf("expected different form to produce a different key, both %q", a.Key)
	}
}

func TestBuildGroupKeyStrengthDistinguishesAndNormalizes(t *testing.T) {
	iu2000 := BuildGroupKey(GroupKeyInput{Core: "Vitamin D3", DosageValue: 2000, DosageUnit: "iu", ProductID: "1"}).Key
	iu1000 := BuildGroupKey(GroupKeyInput{Core: "Vitamin D3", DosageValue: 1000, DosageUnit: "iu", ProductID: "2"}).Key
	if iu2000 == iu1000 {
		t.Fatalf("different strengths must not share a key")
	}
	// 50 mcg of D3 == 2000 IU
	mcg50 := BuildGroupKey(GroupKeyInput{Core: "Vitamin D3", DosageValue: 50, DosageUnit: "mcg", ProductID: "3"}).Key
	if mcg50 != iu2000 {
		t.Fatalf("D3 50mcg should equal 2000IU key: %q vs %q", mcg50, iu2000)
	}

	// mass canonicalization: 1 g == 1000 mg, 5000 mcg == 5 mg
	g1 := BuildGroupKey(GroupKeyInput{Core: "Vitamin C", DosageValue: 1, DosageUnit: "g", ProductID: "4"}).Key
	mg1000 := BuildGroupKey(GroupKeyInput{Core: "Vitamin C", DosageValue: 1000, DosageUnit: "mg", ProductID: "5"}).Key
	if g1 != mg1000 {
		t.Fatalf("1g and 1000mg should share a key: %q vs %q", g1, mg1000)
	}
}

func TestBuildGroupKeyCosmeticDoesNotMergeWithSupplement(t *testing.T) {
	// Q10 capsule (oral supplement) -> Track A
	cap := BuildGroupKey(GroupKeyInput{Core: "Koenzim Q10", Brand: "Dietpharm", Form: "kapsule", DosageValue: 30, DosageUnit: "mg", ProductID: "1"})
	// Q10 face cream (topical) -> Track B
	cream := BuildGroupKey(GroupKeyInput{Core: "Koenzim Q10", Brand: "Nivea", Form: "krema", VolumeValue: 50, VolumeUnit: "ml", ProductID: "2"})
	if cap.Key == cream.Key {
		t.Fatalf("CoQ10 capsule and Q10 cream must not merge")
	}
	if !strings.HasPrefix(cap.Key, "ing:") {
		t.Fatalf("capsule should be ingredient track, got %q", cap.Key)
	}
	if !strings.HasPrefix(cream.Key, "sku:") {
		t.Fatalf("Q10 cream should be the cosmetic brand-sku track, got %q", cream.Key)
	}
}

func TestBuildGroupKeyBrandLineMergesDistinctiveResidualAcrossBrandTitling(t *testing.T) {
	// Same branded product line, titled inconsistently (with/without manufacturer)
	// and slightly different powder weight -> one brand-independent, weight-bucketed
	// group.
	a := BuildGroupKey(GroupKeyInput{Core: "Iso Sensation", Brand: "Ultimate Nutrition", VolumeValue: 910, VolumeUnit: "g", ProductID: "1"})
	b := BuildGroupKey(GroupKeyInput{Core: "Iso Sensation", Brand: "", VolumeValue: 908, VolumeUnit: "g", ProductID: "2"})
	if a.Key != b.Key {
		t.Fatalf("same line should merge regardless of brand titling / 908g~910g: %q vs %q", a.Key, b.Key)
	}
	if !strings.HasPrefix(a.Key, "prod:") {
		t.Fatalf("distinctive residual should use the brand-line track, got %q", a.Key)
	}
	// A different pack size is a different product.
	c := BuildGroupKey(GroupKeyInput{Core: "Iso Sensation", VolumeValue: 2270, VolumeUnit: "g", ProductID: "3"})
	if a.Key == c.Key {
		t.Fatalf("different pack size should not merge, both %q", a.Key)
	}
}

func TestBuildGroupKeyCosmeticDoesNotMergeAcrossBrands(t *testing.T) {
	// Cosmetics keep brand: the same generic descriptor under two brands must NOT
	// merge into one group.
	m1 := BuildGroupKey(GroupKeyInput{Core: "Micelarna", Brand: "Bioderma", Form: "voda", VolumeValue: 250, VolumeUnit: "ml", ProductID: "1"})
	m2 := BuildGroupKey(GroupKeyInput{Core: "Micelarna", Brand: "Garnier", Form: "voda", VolumeValue: 250, VolumeUnit: "ml", ProductID: "2"})
	if m1.Key == m2.Key {
		t.Fatalf("different cosmetic brands must not merge: %q", m1.Key)
	}
	if !strings.HasPrefix(m1.Key, "sku:") {
		t.Fatalf("expected cosmetic brand-sku key, got %q", m1.Key)
	}
	// Same brand + line + size -> one group across vendors.
	m3 := BuildGroupKey(GroupKeyInput{Core: "Micelarna", Brand: "Bioderma", Form: "voda", VolumeValue: 250, VolumeUnit: "ml", ProductID: "3"})
	if m1.Key != m3.Key {
		t.Fatalf("identical cosmetic SKU should merge across vendors: %q vs %q", m1.Key, m3.Key)
	}
}

func TestBuildGroupKeyCosmeticBrandNotInIngredientTrack(t *testing.T) {
	// A cosmetic brand's product is a cosmetic even with an ingredient in the
	// title and no parsed form/volume.
	gk := BuildGroupKey(GroupKeyInput{Core: "Vitamin C", Brand: "Balea", Title: "Balea Koncentrat za lice sa vitaminom C", ProductID: "1"})
	if strings.HasPrefix(gk.Key, "ing:") {
		t.Fatalf("cosmetic-brand product must not be in the ingredient track, got %q", gk.Key)
	}
}

func TestSearchConceptsCanonicalizesIngredients(t *testing.T) {
	req, _ := SearchConcepts("vitamin c")
	if !contains(req, "vitaminc") {
		t.Fatalf("expected compact canonical 'vitaminc' in %v", req)
	}
	req2, _ := SearchConcepts("solgar magnezijum")
	if !contains(req2, "magnezijum") || !contains(req2, "solgar") {
		t.Fatalf("expected both 'magnezijum' and 'solgar' in %v", req2)
	}
	// English spelling maps to the same canonical concept
	req3, _ := SearchConcepts("magnesium")
	if !contains(req3, "magnezijum") {
		t.Fatalf("expected 'magnesium' to canonicalize to 'magnezijum' in %v", req3)
	}
}

func TestSearchConceptsFuzzyResolvesTypos(t *testing.T) {
	// single-token ingredient typo
	if req, _ := SearchConcepts("magnezium"); !contains(req, "magnezijum") {
		t.Fatalf("typo 'magnezium' should resolve to 'magnezijum', got %v", req)
	}
	// multi-word query with a typo in the ingredient word
	if req, _ := SearchConcepts("vitmin c"); !contains(req, "vitaminc") {
		t.Fatalf("typo 'vitmin c' should resolve to 'vitaminc', got %v", req)
	}
}

func TestResidualSynonymUnifiesCaseinSpellings(t *testing.T) {
	a := BuildGroupKey(GroupKeyInput{Core: "Prostar Casein", VolumeValue: 1000, VolumeUnit: "g", ProductID: "1"}).Key
	b := BuildGroupKey(GroupKeyInput{Core: "Prostar Caseine", VolumeValue: 1000, VolumeUnit: "g", ProductID: "2"}).Key
	c := BuildGroupKey(GroupKeyInput{Core: "Prostar Kazein", VolumeValue: 1000, VolumeUnit: "g", ProductID: "3"}).Key
	if a != b || a != c {
		t.Fatalf("casein spelling variants should share a key: %q / %q / %q", a, b, c)
	}
}

func TestBuildGroupKeyBrandedMultivitaminMergesByCoreVariant(t *testing.T) {
	// Same branded multivitamin (no whitelisted ingredient) across vendors and
	// spelling variants ("A do Z" / "A-Z") -> one group (was per-offer singletons).
	a := BuildGroupKey(GroupKeyInput{Core: "Centrum", Title: "Centrum A do Z 30 tableta", Form: "tablete", ProductID: "1"})
	b := BuildGroupKey(GroupKeyInput{Core: "Centrum", Title: "Centrum A-Z 30 tableta", Form: "tablete", ProductID: "2"})
	if a.Key != b.Key {
		t.Fatalf("expected branded multivitamin to merge across vendors, got %q vs %q", a.Key, b.Key)
	}
	if a.Method != "brand-core" {
		t.Fatalf("expected method 'brand-core', got %q", a.Method)
	}
	if strings.HasPrefix(a.Key, "offer:") {
		t.Fatalf("branded multivitamin must not fall to a per-offer key, got %q", a.Key)
	}
	// A different variant must stay separate.
	move := BuildGroupKey(GroupKeyInput{Core: "Centrum Move", Title: "Centrum Move 30 kapsula", Form: "kapsule", ProductID: "3"})
	if move.Key == a.Key {
		t.Fatalf("different variant (Move) must not merge with A-Z, both %q", a.Key)
	}
	// A bare generic multivitamin (no brand/variant) still groups by ingredient.
	generic := BuildGroupKey(GroupKeyInput{Core: "Multivitamin", Title: "Multivitamin 30 tableta", Form: "tablete", ProductID: "4"})
	if generic.Method != "ingredient" {
		t.Fatalf("bare multivitamin should stay ingredient-grouped, got %q", generic.Method)
	}
}

func TestExpandQueryVariantsIncludesCanonical(t *testing.T) {
	variants := ExpandQueryVariants("d3")
	if !contains(variants, "vitamin d3") {
		t.Fatalf("ExpandQueryVariants(d3) should include 'vitamin d3', got %v", variants)
	}
}

func contains(haystack []string, needle string) bool {
	for _, h := range haystack {
		if h == needle {
			return true
		}
	}
	return false
}
