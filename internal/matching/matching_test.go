package matching

import "testing"

func TestNormalizeText(t *testing.T) {
	got := NormalizeText("Čaj protiv кашља 200ML")
	want := "caj protiv kaslja 200ml"
	if got != want {
		t.Fatalf("NormalizeText() = %q, want %q", got, want)
	}
}

func TestExpandQueryVariants(t *testing.T) {
	variants := ExpandQueryVariants("omega3")
	found := map[string]bool{}
	for _, variant := range variants {
		found[variant] = true
	}

	for _, want := range []string{"omega3", "omega 3"} {
		if !found[want] {
			t.Fatalf("ExpandQueryVariants() missing %q in %#v", want, variants)
		}
	}
}

func TestBuildComparableGroupID(t *testing.T) {
	got := BuildComparableGroupID("Vitamin D3", 2000, "IU", 0, "", 60, "caps")
	want := "vitamin d3::dose:2000iu::qty:60::form:kapsule"
	if got != want {
		t.Fatalf("BuildComparableGroupID() = %q, want %q", got, want)
	}
}

func TestBuildDisplayName(t *testing.T) {
	got := BuildDisplayName("Vitamin D3", 2000, "IU", 0, "", 60, "caps")
	want := "Vitamin D3 2000 IU 60 kapsule"
	if got != want {
		t.Fatalf("BuildDisplayName() = %q, want %q", got, want)
	}
}

func TestExtractGroupKey(t *testing.T) {
	got := ExtractGroupKey("NOW Vitamin D3 2000IU 60 kapsula")
	want := "vitamin d3 2000 iu x60"
	if got != want {
		t.Fatalf("ExtractGroupKey() = %q, want %q", got, want)
	}
}
