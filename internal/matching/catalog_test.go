package matching

import (
	"slices"
	"testing"
)

func TestSKUSeparatesBrandsPacksFormsAndVariants(t *testing.T) {
	magnesium := BuildSKUIdentity(GroupKeyInput{Brand: "Solgar", Title: "Solgar Magnezijum citrat 200mg 60 tableta"})
	if magnesium.Brand != "Solgar" {
		t.Fatal("ingredient must not override manufacturer", magnesium.Brand)
	}
	base := GroupKeyInput{Brand: "Solgar", Title: "Solgar Vitamin D3 400IU 100 kapsula", ProductID: "one"}
	want := BuildSKUIdentity(base)
	if !want.Comparable {
		t.Fatal("explicit branded pack must be comparable")
	}
	for _, title := range []string{"Solgar Vitamin D3 400IU 60 kapsula", "Solgar Vitamin D3 1000IU 100 kapsula", "Solgar Vitamin D3 400IU 100 tableta", "Solgar Vitamin D3 400IU kapsula", "Now Foods Vitamin D3 400IU 100 kapsula"} {
		in := base
		in.Title = title
		in.ProductID = title
		if BuildSKUIdentity(in).ID == want.ID {
			t.Fatalf("wrong merge: %s", title)
		}
	}
	for _, pair := range [][2]string{{"Pampers Premium Care 4 20 pelena", "Pampers Premium Care 1 20 pelena"}, {"Hipp pocetno mleko 1 800g", "Hipp pocetno mleko 2 800g"}, {"BioTechUSA Whey vanila 908g", "BioTechUSA Whey vanila 1000g"}, {"BioTechUSA Whey cokolada 908g", "BioTechUSA Whey vanila 908g"}} {
		if BuildSKUIdentity(GroupKeyInput{Brand: "Pampers", Title: pair[0]}).ID == BuildSKUIdentity(GroupKeyInput{Brand: "Pampers", Title: pair[1]}).ID {
			t.Fatalf("variant merge: %v", pair)
		}
	}
}

func TestSKUMergesOnlyReviewedAliasesAndExactUnits(t *testing.T) {
	a := BuildSKUIdentity(GroupKeyInput{Brand: "Biotech", Title: "BioTech Micellar Casein Vanila 1kg"})
	b := BuildSKUIdentity(GroupKeyInput{Brand: "Biotechusa", Title: "BioTechUSA Micellar Casein Vanila 1000g"})
	if a.ID != b.ID {
		t.Fatalf("alias/unit split: %s / %s", a.Signature, b.Signature)
	}
	c := BuildSKUIdentity(GroupKeyInput{Brand: "Solgar", Title: "Solgar vitamin D3 10mcg 100 kapsula"})
	d := BuildSKUIdentity(GroupKeyInput{Brand: "Solgar", Title: "Solgar vitamin D3 400IU 100 kapsula"})
	if c.ID != d.ID {
		t.Fatalf("exact strength conversion split: %s / %s", c.Signature, d.Signature)
	}
}

func TestUnknownIdentityStaysSourceSpecificAndStable(t *testing.T) {
	a := GroupKeyInput{Brand: "Solgar", Title: "Solgar Vitamin D3", SourceID: "https://shop.test/p/123", VendorID: "a"}
	b := a
	b.Title = "SOLGAR VITAMIN D3 akcija"
	if BuildSKUIdentity(a).Comparable || BuildSKUIdentity(a).ID != BuildSKUIdentity(b).ID {
		t.Fatal("unknown pack must remain a stable source offer")
	}
	b.VendorID = "b"
	if BuildSKUIdentity(a).ID == BuildSKUIdentity(b).ID {
		t.Fatal("unknown offers must not merge across vendors")
	}
}

func TestQueryPreservesFormulationAndSingleDigitSize(t *testing.T) {
	for _, c := range []struct{ q, want string }{{"magnezijum citrat", "citrat"}, {"magnezijum bisglicinat", "bisglicinat"}, {"pampers premium care 4", "4"}, {"vitamin d3 2000iu", "measure:2000iu"}, {"magnezijum 375 mg", "measure:375000mcg"}} {
		p := ParseCatalogQuery(c.q)
		if !slices.Contains(p.Required, c.want) {
			t.Fatalf("%s lost %s: %v", c.q, c.want, p.Required)
		}
	}
	p := ParseCatalogQuery("ferveks")
	if p.Text != "fervex" || p.Correction != "fervex" {
		t.Fatal(p)
	}
	if ParseCatalogQuery("магнезијум цитрат").Text != "magnezijum citrat" {
		t.Fatal("Cyrillic normalization")
	}
}

func TestGTINChecksActualCheckDigit(t *testing.T) {
	if !ValidGTIN("4006381333931") || ValidGTIN("4006381333932") || ValidGTIN("not-a-barcode") {
		t.Fatal("invalid GTIN validation")
	}
}

func TestQueryUnitConversionsAndCorrectionsPreserveDecimals(t *testing.T) {
	a := ParseCatalogQuery("whey 2.27kg")
	b := ParseCatalogQuery("whey 2270g")
	if !slices.Equal(a.Required, b.Required) {
		t.Fatal("exact mass conversion differs", a.Required, b.Required)
	}
	a = ParseCatalogQuery("solger vitamin d3 10mcg")
	if a.Correction != "solgar vitamin d3 10mcg" {
		t.Fatal("correction changed the dose text", a.Correction)
	}
	a = ParseCatalogQuery("solger whey 2.27kg")
	if a.Correction != "solgar whey 2.27kg" {
		t.Fatal("correction changed decimal punctuation", a.Correction)
	}
	for _, title := range []string{"Eucerin 10%UREA 250ml", "Urea 10% losion 250ml"} {
		_ = BuildSKUIdentity(GroupKeyInput{Title: title, Brand: "Eucerin"})
	}
}

func TestCatalogStableStrengthAndUnknownFamilies(t *testing.T) {
	a := BuildSKUIdentity(GroupKeyInput{Title: "Solgar Vitamin D3 50mcg 60 kapsula", Brand: "Solgar"})
	b := BuildSKUIdentity(GroupKeyInput{Title: "Solgar Vitamin D3 2000IU 60 kapsula", Brand: "Solgar"})
	if a.Dosage != b.Dosage || a.DosageUnit != b.DosageUnit {
		t.Fatalf("equivalent strengths have unstable facets: %+v %+v", a, b)
	}
	a = BuildSKUIdentity(GroupKeyInput{Title: "Unclassified toothbrush", SourceID: "a"})
	b = BuildSKUIdentity(GroupKeyInput{Title: "Unclassified shampoo", SourceID: "b"})
	if a.FamilyID == b.FamilyID {
		t.Fatal("missing core metadata must not create one unrelated family")
	}
}

func TestDiaperSizeDoesNotMatchWeightRange(t *testing.T) {
	plan := ParseCatalogQuery("pampers premium care 4")
	wrong := BuildSKUIdentity(GroupKeyInput{Title: "Pampers Premium Care, veličina 2, 46 kom, 4kg-8kg", Brand: "Pampers"})
	right := BuildSKUIdentity(GroupKeyInput{Title: "Pampers Premium Care 4 20 pelena 9-14kg", Brand: "Pampers"})
	has := func(tokens []string, want string) bool {
		for _, t := range tokens {
			if t == want {
				return true
			}
		}
		return false
	}
	if !has(plan.Required, "size:4") || has(wrong.Tokens, "size:4") || !has(right.Tokens, "size:4") {
		t.Fatal("size confused with weight", plan, wrong.Tokens, right.Tokens)
	}
}
