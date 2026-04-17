import unittest

from matching_utils import (
    build_search_metadata,
    build_standardization_payload,
    build_standardized_title,
    normalize_form,
    normalize_lookup_text,
)


class MatchingUtilsTest(unittest.TestCase):
    def test_normalize_lookup_text_handles_serbian_variants(self):
        self.assertEqual(normalize_lookup_text("Čaj protiv кашља"), "caj protiv kaslja")

    def test_normalize_form_canonicalizes_aliases(self):
        self.assertEqual(normalize_form("caps"), "kapsule")
        self.assertEqual(normalize_form("tableta"), "tablete")

    def test_build_standardized_title_prefers_canonical_name(self):
        title = build_standardized_title(
            {
                "title": "Raw vendor title",
                "normalized_name": "Solgar Vitamin D3 2000 IU kapsule",
                "brand": "Solgar",
                "core_product_identity": "Vitamin D3",
                "dosage_value": 2000,
                "dosage_unit": "iu",
                "quantity_value": 60,
                "form": "caps",
            }
        )
        self.assertEqual(title, "Solgar Vitamin D3 2000 IU kapsule")

    def test_build_standardization_payload_keeps_raw_title_as_original(self):
        payload = build_standardization_payload(
            {
                "title": "Solgar Vitamin D3 2000IU 60 caps",
                "normalized_name": "Solgar Vitamin D3 2000 IU kapsule",
                "brand": "Solgar",
                "form": "caps",
                "dosage_value": 2000,
                "dosage_unit": "IU",
                "quantity_value": 60,
                "quantity_unit": "caps",
                "volume_value": None,
                "volume_unit": None,
            }
        )
        self.assertEqual(payload["original_title"], "Solgar Vitamin D3 2000IU 60 caps")
        self.assertEqual(payload["title"], "Solgar Vitamin D3 2000 IU kapsule")
        self.assertEqual(payload["normalized_name"], "solgar vitamin d3 2000 iu kapsule")

    def test_build_search_metadata_adds_compact_tokens_and_tags(self):
        tokens, tags = build_search_metadata(
            {
                "title": "Solgar Vitamin D3 2000IU 60 caps",
                "brand": "Solgar",
                "core_product_identity": "Vitamin D3",
                "normalized_name": "Solgar Vitamin D3 2000 IU kapsule",
                "dosage_value": 2000,
                "dosage_unit": "IU",
                "quantity_value": 60,
                "form": "caps",
            }
        )

        for expected in ("solgar", "vitamin", "d3", "2000iu", "60", "vitamind3"):
            self.assertIn(expected, tokens)
        for expected in ("brand:solgar", "core:vitamin d3", "dose:2000 iu", "form:kapsule", "qty:60"):
            self.assertIn(expected, tags)


if __name__ == "__main__":
    unittest.main()
