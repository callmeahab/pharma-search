import unittest

import dictionaries
import populate_missing_data as p


def extract(title):
    e = p.post_process_extraction(p.extract_entities_rule_based(title), title)
    e["core"] = p._extract_core_ingredient(title, e.get("brand"))
    return e


class IngredientDetectionTest(unittest.TestCase):
    def test_aliases_collapse_to_canonical(self):
        self.assertEqual(dictionaries.supplement_ingredients("NOW Vitamin D3 2000IU"), ["vitamin d3"])
        self.assertEqual(dictionaries.supplement_ingredients("Solgar Magnesium Citrate"), ["magnezijum"])
        self.assertEqual(dictionaries.supplement_ingredients("d3"), ["vitamin d3"])

    def test_combo_decomposes_and_sorts(self):
        self.assertEqual(
            dictionaries.supplement_ingredients("Magnezijum + B6 30 tableta"),
            ["magnezijum", "vitamin b6"],
        )

    def test_non_ingredient_returns_empty(self):
        self.assertEqual(dictionaries.supplement_ingredients("Bioderma micelarna voda"), [])


class DosageExtractionTest(unittest.TestCase):
    def test_iu_with_trailing_period(self):
        m = p.extract_measures("VITAMIN D3 2000 I.U. KAPSULE A30")
        self.assertEqual((m["dosage_value"], m["dosage_unit"]), (2000.0, "iu"))

    def test_thousands_separator(self):
        m = p.extract_measures("Vitamin C 1.000 mg 20 kesica")
        self.assertEqual((m["dosage_value"], m["dosage_unit"]), (1000.0, "mg"))

    def test_slash_pack_dosage(self):
        m = p.extract_measures("Vitamin D3 (30tbl/2000IU)")
        self.assertEqual((m["dosage_value"], m["dosage_unit"]), (2000.0, "iu"))

    def test_thousands_collapse_does_not_eat_ingredient_code(self):
        # the "3" in D3 must not merge with 400 to make 3400
        self.assertEqual(p.extract_measures("Solgar Vitamin D3 400 IJ 100 kapsula")["dosage_value"], 400.0)
        self.assertEqual(p.extract_measures("B12 200 mcg 30 tableta")["dosage_value"], 200.0)
        # genuine thousands separators still collapse
        self.assertEqual(p.extract_measures("Vitamin C 1 000 mg")["dosage_value"], 1000.0)

    def test_volume_not_dosage(self):
        m = p.extract_measures("Solgar Vitamin D3 2500IU rastvor 59ml")
        self.assertEqual((m["dosage_value"], m["dosage_unit"]), (2500.0, "iu"))
        self.assertEqual((m["volume_value"], m["volume_unit"]), (59.0, "ml"))


class QuantityAndBareIUTest(unittest.TestCase):
    def test_large_count_before_form_is_not_quantity(self):
        e = extract("DETRICAL 2000 TABLETE A60")
        self.assertEqual(e["quantity_value"], 60)          # a60, not 2000
        self.assertEqual((e["dosage_value"], e["dosage_unit"]), (2000.0, "iu"))

    def test_bare_iu_for_vitamin_d(self):
        for title, iu, qty in [
            ("Detrical 2000 60 tableta", 2000.0, 60),
            ("Ultra vitamin D 1000, 96 tableta", 1000.0, 96),
            ("Detrical 4000 60 tableta", 4000.0, 60),
        ]:
            e = extract(title)
            self.assertEqual(e["dosage_value"], iu, title)
            self.assertEqual(e["dosage_unit"], "iu", title)
            self.assertEqual(e["quantity_value"], qty, title)

    def test_bare_mg_for_vitamin_c(self):
        self.assertEqual(p.infer_bare_mg("Vitamin C 1000 30 tableta", 30), 1000.0)
        self.assertEqual(p.infer_bare_mg("CeeWell Vitamin C-500", None), 500.0)
        self.assertIsNone(p.infer_bare_mg("Vitamin C 30 tableta", 30))  # 30 is count

    def test_bare_iu_skips_combos(self):
        # the "1000" here is Vitamin C's mg, not D3 IU -> must NOT be inferred
        e = extract("Doppelherz Aktiv vitamin C 1000 + vitamin D3 30 tableta")
        self.assertIsNone(e["dosage_value"])

    def test_bare_iu_ignores_non_iu_numbers(self):
        e = extract("Vitamin D3 60 tableta")  # 60 is the count, no strength
        self.assertIsNone(e["dosage_value"])


class GummyVitaminTest(unittest.TestCase):
    def test_gummy_brand_defaults_to_bombone_form(self):
        e = extract("GUMEDIĆI SA VITAMINOM C A60")
        self.assertEqual(e["brand"], "Gumedici")
        self.assertEqual(p.normalize_form(e["form"]), "bombone")

    def test_gummy_words_normalize_to_bombone(self):
        for t in ["Gumedići Vitamin C gumene bombone 60 kom",
                  "Gumedići Vitamin C pektinske bombone za decu"]:
            self.assertEqual(p.normalize_form(extract(t)["form"]), "bombone", t)

    def test_vitamini_minerali_is_multivitamin(self):
        import dictionaries as d
        self.assertEqual(d.supplement_ingredients("Gumedići sa vitaminima i mineralima"), ["multivitamin"])


class CoreIdentityTest(unittest.TestCase):
    def test_strips_pack_unit_noise(self):
        self.assertEqual(extract("Vitamin D3, 90kap")["core"], "Vitamin D3")
        self.assertEqual(extract("VITAMIN D3 2000 I.U. KAPSULE A30")["core"], "Vitamin D3")

    def test_brand_not_swallowing_ingredient(self):
        e = extract("Dietpharm Koenzim Q10 30 kapsula")
        self.assertEqual(e["brand"], "Dietpharm")
        self.assertEqual(e["core"], "Koenzim Q10")

    def test_hyphen_strength_does_not_break_ingredient(self):
        # "C-1000" is Vitamin C 1000, not a code; identity must stay "Vitamin C"
        self.assertEqual(extract("Now vitamin C-1000 100 tableta")["core"], "Vitamin C")
        self.assertEqual(extract("Vitamin E-400, 100kap")["core"], "Vitamin E")
        # short vitamer codes still fuse
        self.assertEqual(extract("Vitamin D-3 2000 IU")["core"], "Vitamin D3")

    def test_cross_brand_collapse(self):
        self.assertEqual(extract("NOW Vitamin D3 2000IU 60 kapsula")["core"], "Vitamin D3")
        self.assertEqual(extract("Solgar Vitamin D3 2000 IU 30 tableta")["core"], "Vitamin D3")


if __name__ == "__main__":
    unittest.main()
