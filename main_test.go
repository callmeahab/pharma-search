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

func TestConvertHitsToGroupsFoldsFormlessIntoDominantForm(t *testing.T) {
	mk := func(id, vendor, form string) map[string]interface{} {
		return map[string]interface{}{
			"id": id, "title": "Vitamin C 1000", "price": 100.0,
			"vendorId": vendor, "vendorName": vendor, "link": "", "thumbnail": "",
			"brand": "", "normalizedName": "vitamin c 1000",
			"coreProductIdentity": "vitamin c", "dosageValue": 1000.0, "dosageUnit": "mg",
			"form": form,
		}
	}
	hits := []map[string]interface{}{
		mk("p1", "vendor-a", "tablete"),
		mk("p2", "vendor-b", "tablete"),
		mk("p3", "vendor-c", ""), // form unknown -> should fold into tablete
	}
	groups := convertHitsToGroups(hits, "vitamin c", nil)
	if len(groups) != 1 {
		t.Fatalf("expected formless to fold into the dominant form -> 1 group, got %d", len(groups))
	}
	if got := int(getFloat(groups[0], "vendor_count")); got != 3 {
		t.Fatalf("expected 3 vendors in the merged group, got %d", got)
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

func TestConvertHitsToGroupsRanksByCoverageWithinRelevanceTier(t *testing.T) {
	hits := []map[string]interface{}{
		// A single-vendor magnesium offer: relevant to the query but low coverage.
		{
			"id":                  "mag-1",
			"title":               "Magnezijum 300 mg 30 kapsula",
			"price":               700.0,
			"vendorId":            "vendor-a",
			"vendorName":          "Vendor A",
			"brand":               "BrandA",
			"normalizedName":      "magnezijum 300 mg",
			"coreProductIdentity": "magnezijum",
			"dosageValue":         300.0,
			"dosageUnit":          "mg",
			"form":                "kapsule",
		},
		// A different magnesium strength stocked by two vendors: same relevance
		// tier, higher coverage -> should rank first.
		{
			"id":                  "mag-2",
			"title":               "Magnezijum 375 mg 60 kapsula",
			"price":               900.0,
			"vendorId":            "vendor-b",
			"vendorName":          "Vendor B",
			"brand":               "BrandB",
			"normalizedName":      "magnezijum 375 mg",
			"coreProductIdentity": "magnezijum",
			"dosageValue":         375.0,
			"dosageUnit":          "mg",
			"form":                "kapsule",
		},
		{
			"id":                  "mag-3",
			"title":               "Magnezijum 375 mg 60 kapsula",
			"price":               950.0,
			"vendorId":            "vendor-c",
			"vendorName":          "Vendor C",
			"brand":               "BrandC",
			"normalizedName":      "magnezijum 375 mg",
			"coreProductIdentity": "magnezijum",
			"dosageValue":         375.0,
			"dosageUnit":          "mg",
			"form":                "kapsule",
		},
		// An unrelated product: must rank below both (lower relevance tier).
		{
			"id":                  "vc-1",
			"title":               "Vitamin C 500 mg 30 tableta",
			"price":               400.0,
			"vendorId":            "vendor-d",
			"vendorName":          "Vendor D",
			"brand":               "BrandD",
			"normalizedName":      "vitamin c 500 mg",
			"coreProductIdentity": "vitamin c",
			"dosageValue":         500.0,
			"dosageUnit":          "mg",
			"form":                "tablete",
		},
	}

	groups := convertHitsToGroups(hits, "magnezijum", nil)
	if len(groups) != 3 {
		t.Fatalf("expected 3 groups, got %d", len(groups))
	}

	// Within the magnesium relevance tier, the 2-vendor 375mg group outranks the
	// 1-vendor 300mg group (coverage tie-break).
	if got := getString(groups[0], "id"); got != "ing:magnezijum::375mg::form:kapsule" {
		t.Fatalf("expected highest-coverage magnesium group first, got %q", got)
	}
	if got := int(getFloat(groups[0], "vendor_count")); got != 2 {
		t.Fatalf("expected top group vendor_count=2, got %d", got)
	}

	// The unrelated Vitamin C group is in a lower relevance tier and must rank last.
	if got := getString(groups[2], "id"); got != "ing:vitamin c::500mg::form:tablete" {
		t.Fatalf("expected unrelated group last, got %q", got)
	}
}
