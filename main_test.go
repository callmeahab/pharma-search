package main

import "testing"

func TestConvertHitsToGroupsDedupesVendorsAndRecalculatesPriceRange(t *testing.T) {
	hits := []map[string]interface{}{
		{
			"id":                  "p1",
			"title":               "Omega 3 1000 mg 30 kapsula",
			"price":               1000.0,
			"vendorId":            "vendor-a",
			"vendorName":          "Vendor A",
			"link":                "https://a.test/1",
			"thumbnail":           "",
			"brand":               "Brand",
			"normalizedName":      "omega 3 1000 mg 30 kapsula",
			"coreProductIdentity": "omega 3",
			"dosageValue":         1000.0,
			"dosageUnit":          "mg",
			"form":                "kapsule",
			"quantityValue":       30.0,
		},
		{
			"id":                  "p2",
			"title":               "Omega 3 1000 mg 30 kapsula akcija",
			"price":               1100.0,
			"vendorId":            "vendor-a",
			"vendorName":          "Vendor A",
			"link":                "https://a.test/2",
			"thumbnail":           "",
			"brand":               "Brand",
			"normalizedName":      "omega 3 1000 mg 30 kapsula",
			"coreProductIdentity": "omega 3",
			"dosageValue":         1000.0,
			"dosageUnit":          "mg",
			"form":                "kapsule",
			"quantityValue":       30.0,
		},
		{
			"id":                  "p3",
			"title":               "Omega 3 1000 mg 30 kapsula",
			"price":               1200.0,
			"vendorId":            "vendor-b",
			"vendorName":          "Vendor B",
			"link":                "https://b.test/1",
			"thumbnail":           "",
			"brand":               "Brand",
			"normalizedName":      "omega 3 1000 mg 30 kapsula",
			"coreProductIdentity": "omega 3",
			"dosageValue":         1000.0,
			"dosageUnit":          "mg",
			"form":                "kapsule",
			"quantityValue":       30.0,
		},
	}

	groups := convertHitsToGroups(hits, "omega 3", nil)
	if len(groups) != 1 {
		t.Fatalf("expected 1 group, got %d", len(groups))
	}

	group := groups[0]
	products := getSlice(group, "products")
	if got := len(products); got != 2 {
		t.Fatalf("expected 2 visible products after dedupe, got %d", got)
	}

	if got := int(getFloat(group, "vendor_count")); got != 2 {
		t.Fatalf("expected vendor_count=2, got %d", got)
	}

	if got := int(getFloat(group, "product_count")); got != 3 {
		t.Fatalf("expected raw product_count=3, got %d", got)
	}

	priceRange := getMap(group, "price_range")
	if got := getFloat(priceRange, "min"); got != 1000 {
		t.Fatalf("expected min price 1000, got %.2f", got)
	}
	if got := getFloat(priceRange, "max"); got != 1200 {
		t.Fatalf("expected max price 1200, got %.2f", got)
	}
	if got := getFloat(priceRange, "avg"); got != 1100 {
		t.Fatalf("expected avg price 1100, got %.2f", got)
	}
}

func TestBuildFacetsFromHitsSupportsGroupedProductKeys(t *testing.T) {
	hits := []map[string]interface{}{
		{
			"vendor_name": "Vendor A",
			"brand_name":  "Brand",
			"dosage_unit": "mg",
			"form":        "kapsule",
			"quantity":    30.0,
		},
		{
			"vendor_name": "Vendor B",
			"brand_name":  "Brand",
			"dosage_unit": "mg",
			"form":        "kapsule",
			"quantity":    30.0,
		},
	}

	facets := buildFacetsFromHits(hits)

	if got := facets["vendorName"].Values["Vendor A"]; got != 1 {
		t.Fatalf("expected Vendor A facet count 1, got %d", got)
	}
	if got := facets["brand"].Values["Brand"]; got != 2 {
		t.Fatalf("expected Brand facet count 2, got %d", got)
	}
	if got := facets["dosageUnit"].Values["mg"]; got != 2 {
		t.Fatalf("expected dosageUnit facet count 2, got %d", got)
	}
	if got := facets["form"].Values["kapsule"]; got != 2 {
		t.Fatalf("expected form facet count 2, got %d", got)
	}
	if got := facets["quantity"].Values["30"]; got != 2 {
		t.Fatalf("expected quantity facet count 2, got %d", got)
	}
}

func TestConvertHitsToGroupsSortsBySearchRelevanceBeforeVendorCoverage(t *testing.T) {
	hits := []map[string]interface{}{
		{
			"id":                  "best-match",
			"title":               "Detrical D3 2000 IU 30 tableta",
			"price":               890.0,
			"vendorId":            "vendor-a",
			"vendorName":          "Vendor A",
			"link":                "https://a.test/detrical",
			"thumbnail":           "",
			"brand":               "Detrical",
			"normalizedName":      "vitamin d3 2000 iu 30 tableta",
			"coreProductIdentity": "vitamin d3",
			"dosageValue":         2000.0,
			"dosageUnit":          "iu",
			"form":                "tablete",
			"quantityValue":       30.0,
		},
		{
			"id":                  "generic-1",
			"title":               "Vitamin D3 2000 IU 60 tableta",
			"price":               990.0,
			"vendorId":            "vendor-b",
			"vendorName":          "Vendor B",
			"link":                "https://b.test/d3",
			"thumbnail":           "",
			"brand":               "OtherBrand",
			"normalizedName":      "vitamin d3 2000 iu 60 tableta",
			"coreProductIdentity": "vitamin d3",
			"dosageValue":         2000.0,
			"dosageUnit":          "iu",
			"form":                "tablete",
			"quantityValue":       60.0,
		},
		{
			"id":                  "generic-2",
			"title":               "Vitamin D3 2000 IU 60 tableta",
			"price":               1020.0,
			"vendorId":            "vendor-c",
			"vendorName":          "Vendor C",
			"link":                "https://c.test/d3",
			"thumbnail":           "",
			"brand":               "OtherBrand",
			"normalizedName":      "vitamin d3 2000 iu 60 tableta",
			"coreProductIdentity": "vitamin d3",
			"dosageValue":         2000.0,
			"dosageUnit":          "iu",
			"form":                "tablete",
			"quantityValue":       60.0,
		},
	}

	groups := convertHitsToGroups(hits, "detrical d3", nil)
	if len(groups) != 2 {
		t.Fatalf("expected 2 groups, got %d", len(groups))
	}

	if got := getString(groups[0], "id"); got == getString(groups[1], "id") {
		t.Fatalf("expected distinct groups, got duplicate id %q", got)
	}

	topGroupProducts := getSlice(groups[0], "products")
	if len(topGroupProducts) != 1 {
		t.Fatalf("expected top group to keep the single best-match offer, got %d products", len(topGroupProducts))
	}

	topProduct, ok := topGroupProducts[0].(map[string]interface{})
	if !ok {
		t.Fatalf("expected top product to be a product map")
	}

	if got := getString(topProduct, "brand_name"); got != "Detrical" {
		t.Fatalf("expected most relevant Detrical group first, got brand %q", got)
	}
}
