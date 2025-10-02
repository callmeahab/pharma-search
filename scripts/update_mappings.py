#!/usr/bin/env python3
"""
Auto-Update Product Grouping Mappings

This script analyzes products.csv and automatically updates comprehensive_mappings.go
with all brand, unit, and form variations found in the data.

Run this after scraping new sources to keep mappings up-to-date.

Usage:
    python3 scripts/update_mappings.py
    python3 scripts/update_mappings.py --products-file path/to/products.csv
    python3 scripts/update_mappings.py --min-brand-count 5
"""

import re
import argparse
from collections import Counter, defaultdict
from pathlib import Path
import sys

class MappingExtractor:
    def __init__(self, products_file, min_brand_count=10):
        self.products_file = products_file
        self.min_brand_count = min_brand_count

        # Patterns
        self.dosage_pattern = re.compile(
            r'(\d+(?:[.,]\d+)?)\s*(mg|g|gr|mcg|μg|µg|iu|ie|i\.j\.|ij|ml|l)\b',
            re.IGNORECASE
        )
        self.form_pattern = re.compile(
            r'\b(tablet|tabl|tableta|tablete|caps|capsule|kapsul|kapsula|gel|'
            r'krema|cream|losion|lotion|sprej|spray|sirup|syrup|kapi|drops|'
            r'powder|prah|prašak|šumeće|šumeća|kesica|sachet|softgel|gelcaps|'
            r'mast|ointment|balzam|balsam|balm|serum|maska|mask|šampon|'
            r'shampoo|sapun|soap|effervescent)\w*\b',
            re.IGNORECASE
        )

        # Supplement keywords for ingredient detection
        self.supplement_keywords = [
            'vitamin', 'mineral', 'omega', 'protein', 'whey', 'calcium', 'kalcijum',
            'magnesium', 'magnezijum', 'zinc', 'cink', 'iron', 'železo', 'gvožđe',
            'selenium', 'selen', 'kolagen', 'collagen', 'probiotic', 'probiotik',
            'kreatin', 'creatine', 'glutamin', 'glutamine', 'bcaa', 'eaa',
            'coq10', 'q10', 'glucosamine', 'glukozamin', 'chondroitin', 'hondroitin',
            'hyaluronic', 'hijaluronska'
        ]

        # Storage
        self.brands = Counter()
        self.dosage_units = Counter()
        self.forms = Counter()
        self.active_ingredients = defaultdict(set)

    def analyze(self):
        """Analyze all products and extract mappings"""
        print(f"📊 Analyzing products from {self.products_file}...")

        line_count = 0
        with open(self.products_file, 'r', encoding='utf-8') as f:
            next(f)  # Skip header

            for line in f:
                line_count += 1
                if line_count % 10000 == 0:
                    print(f"  Processed {line_count:,} products...", file=sys.stderr)

                parts = line.strip().split(';', 1)
                if len(parts) != 2:
                    continue

                price, title = parts
                title_lower = title.lower()

                # Extract brand (first word if capitalized and reasonable length)
                words = title.split()
                if words:
                    first_word = words[0].strip('®™©')
                    if len(first_word) >= 3 and not first_word.isdigit():
                        self.brands[first_word.upper()] += 1

                # Extract dosage units
                for match in self.dosage_pattern.finditer(title_lower):
                    value, unit = match.groups()
                    self.dosage_units[unit.lower()] += 1

                # Extract forms
                for match in self.form_pattern.finditer(title_lower):
                    self.forms[match.group(1).lower()] += 1

                # Extract active ingredients contexts
                for keyword in self.supplement_keywords:
                    if keyword in title_lower:
                        idx = title_lower.find(keyword)
                        context_start = max(0, idx - 20)
                        context_end = min(len(title_lower), idx + len(keyword) + 20)
                        context = title_lower[context_start:context_end]
                        self.active_ingredients[keyword].add(context.strip())

        print(f"✅ Analyzed {line_count:,} products")
        return self

    def generate_brand_map(self):
        """Generate Go code for brand mappings"""
        lines = []
        lines.append('// BuildBrandMap returns comprehensive brand name mappings')
        lines.append('// Auto-generated from product data analysis')
        lines.append('func BuildBrandMap() map[string]string {')
        lines.append('\treturn map[string]string{')

        # Get brands with sufficient count
        top_brands = [
            (brand, count)
            for brand, count in self.brands.most_common(200)
            if count >= self.min_brand_count
        ]

        for brand, count in top_brands:
            brand_lower = brand.lower()
            brand_title = self._to_title_case(brand)
            lines.append(f'\t\t"{brand_lower}": "{brand_title}",  // {count:,} products')

        lines.append('\t}')
        lines.append('}')

        return '\n'.join(lines)

    def generate_dosage_unit_map(self):
        """Generate Go code for dosage unit mappings"""
        lines = []
        lines.append('// BuildDosageUnitMap returns all dosage unit variations')
        lines.append('// Auto-generated from product data analysis')
        lines.append('func BuildDosageUnitMap() map[string]string {')
        lines.append('\treturn map[string]string{')

        # Define canonical forms for each unit
        unit_canonicals = {
            'mg': 'mg',
            'g': 'g',
            'gr': 'g',
            'mcg': 'mcg',
            'μg': 'mcg',
            'µg': 'mcg',
            'kg': 'kg',
            'iu': 'iu',
            'ie': 'iu',
            'ij': 'iu',
            'i.j.': 'iu',
            'ml': 'ml',
            'l': 'l',
            'dl': 'dl',
            '%': '%',
        }

        for unit, count in sorted(self.dosage_units.items(), key=lambda x: -x[1]):
            canonical = unit_canonicals.get(unit, unit)
            lines.append(f'\t\t"{unit}": "{canonical}",  // {count:,} occurrences')

        lines.append('\t}')
        lines.append('}')

        return '\n'.join(lines)

    def generate_form_map(self):
        """Generate Go code for form mappings"""
        lines = []
        lines.append('// BuildFormMap returns all product form variations')
        lines.append('// Auto-generated from product data analysis')
        lines.append('func BuildFormMap() map[string]string {')
        lines.append('\treturn map[string]string{')

        # Define canonical forms
        form_canonicals = {
            # Tablets
            'tablet': 'tablet',
            'tabl': 'tablet',
            'tableta': 'tablet',
            'tablete': 'tablet',
            'tbl': 'tablet',
            'ftbl': 'tablet',
            'šumeće': 'effervescent',
            'šumeća': 'effervescent',
            'effervescent': 'effervescent',

            # Capsules
            'capsule': 'capsule',
            'kapsula': 'capsule',
            'kapsul': 'capsule',
            'kapsule': 'capsule',
            'caps': 'capsule',
            'cap': 'capsule',
            'softgel': 'softgel',
            'gelcaps': 'softgel',
            'gelkaps': 'softgel',
            'gc': 'softgel',

            # Creams
            'krema': 'cream',
            'cream': 'cream',
            'krem': 'cream',

            # Gels
            'gel': 'gel',
            'gela': 'gel',

            # Lotions
            'losion': 'lotion',
            'lotion': 'lotion',
            'mleko': 'lotion',

            # Sprays
            'sprej': 'spray',
            'spray': 'spray',

            # Powders
            'powder': 'powder',
            'prah': 'powder',
            'prašak': 'powder',

            # Liquids
            'kapi': 'drops',
            'drops': 'drops',
            'sirup': 'syrup',
            'syrup': 'syrup',

            # Sachets
            'kesica': 'sachet',
            'sachet': 'sachet',
            'stick': 'sachet',

            # Others
            'mast': 'ointment',
            'ointment': 'ointment',
            'balzam': 'balm',
            'balsam': 'balm',
            'balm': 'balm',
            'serum': 'serum',
            'maska': 'mask',
            'mask': 'mask',
            'šampon': 'shampoo',
            'shampoo': 'shampoo',
            'sapun': 'soap',
            'soap': 'soap',
        }

        for form, count in sorted(self.forms.items(), key=lambda x: -x[1]):
            if count >= 50:  # Only include forms with 50+ occurrences
                canonical = form_canonicals.get(form, form)
                lines.append(f'\t\t"{form}": "{canonical}",  // {count:,} occurrences')

        lines.append('\t}')
        lines.append('}')

        return '\n'.join(lines)

    def generate_ingredient_map(self):
        """Generate Go code for active ingredient mappings"""
        lines = []
        lines.append('// BuildActiveIngredientMap returns comprehensive ingredient mappings')
        lines.append('// Auto-generated from product data analysis')
        lines.append('func BuildActiveIngredientMap() map[string][]string {')
        lines.append('\treturn map[string][]string{')

        # Define ingredient groups based on analysis
        ingredient_groups = self._build_ingredient_groups()

        for canonical, aliases in sorted(ingredient_groups.items()):
            lines.append(f'\t\t// {canonical.replace("_", " ").title()}')
            lines.append(f'\t\t"{canonical}": {{')

            # Format aliases nicely (4 per line)
            for i in range(0, len(aliases), 4):
                chunk = aliases[i:i+4]
                formatted = ', '.join(f'"{alias}"' for alias in chunk)
                lines.append(f'\t\t\t{formatted},')

            lines.append('\t\t},')
            lines.append('')

        lines.append('\t}')
        lines.append('}')

        return '\n'.join(lines)

    def _build_ingredient_groups(self):
        """Build ingredient groups from analyzed data"""
        return {
            "vitamin_d": [
                "vitamin d3", "vitamin d 3", "vitamin d-3", "vitamind3",
                "vitamin d", "cholecalciferol", "d3", "d 3",
                "holekalciferol",
            ],
            "vitamin_c": [
                "vitamin c", "vitamin c+", "vitaminc",
                "ascorbic acid", "askorbinska", "askorbinska kiselina",
                "cevital",
            ],
            "vitamin_e": [
                "vitamin e", "vitamin e+", "vitamine",
                "tocopherol", "tokoferol",
            ],
            "vitamin_a": [
                "vitamin a", "vitamina",
                "retinol", "retinol palmitate",
            ],
            "vitamin_k": [
                "vitamin k", "vitamin k1", "vitamin k2",
                "phylloquinone", "menaquinone",
            ],
            "vitamin_b12": [
                "vitamin b12", "vitamin b 12", "vitamin b-12",
                "b12", "b 12", "b-12",
                "cobalamin", "cyanocobalamin", "methylcobalamin",
            ],
            "vitamin_b6": [
                "vitamin b6", "vitamin b 6", "vitamin b-6",
                "b6", "pyridoxine",
            ],
            "b_complex": [
                "b complex", "b-complex", "b komplex",
                "vitamin b complex", "b vitamins",
            ],
            "multivitamin": [
                "multivitamin", "multi vitamin", "multi-vitamin",
                "polivitamin",
            ],
            "omega_3": [
                "omega 3", "omega-3", "omega3", "omega 3+",
                "fish oil", "riblje ulje",
                "epa", "dha", "epa dha", "epa+dha",
                "omega boost", "omega vite",
            ],
            "calcium": [
                "calcium", "ca", "calcium+",
                "kalcijum",
                "calcium carbonate", "calcium citrate",
                "kalcijumkarbonat",
            ],
            "magnesium": [
                "magnesium", "mg", "magnesium+",
                "magnezijum",
                "magnesium oxide", "magnesium citrate",
            ],
            "zinc": [
                "zinc", "zn", "zinc+",
                "cink",
                "zinc gluconate", "zinc picolinate", "zinc citrate",
            ],
            "iron": [
                "iron", "fe",
                "gvožđe", "železo",
                "ferrous sulfate", "ferrous gluconate",
            ],
            "selenium": [
                "selenium", "se",
                "selen",
            ],
            "protein": [
                "protein", "whey", "casein",
                "proteinski",
                "protein powder", "whey protein", "casein protein",
                "isolate", "concentrate", "hydrolyzed",
            ],
            "creatine": [
                "creatine", "kreatin",
                "creatine monohydrate", "creatine hcl",
                "kre-alkalyn",
            ],
            "bcaa": [
                "bcaa", "branched chain amino acids",
                "bcaa+", "bcaa flow",
            ],
            "eaa": [
                "eaa", "essential amino acids",
                "eaa+", "eaa zero",
            ],
            "glutamine": [
                "glutamine", "glutamin",
                "l-glutamine", "l glutamine",
            ],
            "collagen": [
                "collagen", "kolagen",
                "collagen peptides", "hydrolyzed collagen",
                "peptan",
            ],
            "coq10": [
                "coq10", "co q10", "co-q10", "q10",
                "coenzyme q10", "ubiquinol", "ubiquinone",
                "koenzim q10",
            ],
            "probiotic": [
                "probiotic", "probiotik",
                "probiotics", "lactobacillus", "bifidobacterium",
            ],
            "glucosamine": [
                "glucosamine", "glukozamin",
                "glucosamine sulfate", "glucosamine hcl",
            ],
            "chondroitin": [
                "chondroitin", "hondroitin",
                "chondroitin sulfate",
            ],
            "hyaluronic": [
                "hyaluronic", "hyaluronic acid", "hyaluron",
                "hijaluronska",
            ],
        }

    def _to_title_case(self, brand):
        """Convert brand to proper title case"""
        # Special cases
        special_cases = {
            'NIVEA': 'Nivea',
            'VICHY': 'Vichy',
            'BIODERMA': 'Bioderma',
            'EUCERIN': 'Eucerin',
            'URIAGE': 'Uriage',
            'LA ROCHE-POSAY': 'La Roche-Posay',
            'L\'OREAL': 'L\'Oreal',
            'L\'ORÉAL': 'L\'Oréal',
            'OPI': 'OPI',
            'NYX': 'NYX',
            'SVR': 'SVR',
            'ESI': 'ESI',
            'GNC': 'GNC',
            'NOW': 'Now Foods',
            'CERAVE': 'CeraVe',
        }

        if brand in special_cases:
            return special_cases[brand]

        # Default title case
        return brand.title()

    def write_mappings_file(self, output_path):
        """Write complete mappings Go file"""
        lines = []
        lines.append('package main')
        lines.append('')
        lines.append('// ComprehensiveMappings contains all variations extracted from product data')
        lines.append('// Auto-generated - DO NOT EDIT MANUALLY')
        lines.append('// Run scripts/update_mappings.py to regenerate')
        lines.append('')

        lines.append(self.generate_brand_map())
        lines.append('')
        lines.append(self.generate_dosage_unit_map())
        lines.append('')
        lines.append(self.generate_form_map())
        lines.append('')
        lines.append(self.generate_ingredient_map())
        lines.append('')

        # Write file
        output_path.write_text('\n'.join(lines))
        print(f"✅ Generated {output_path}")

        # Print stats
        print(f"\n📊 Mappings Generated:")
        print(f"  - {len([b for b in self.brands.values() if b >= self.min_brand_count])} brands")
        print(f"  - {len(self.dosage_units)} dosage units")
        print(f"  - {len([f for f, c in self.forms.items() if c >= 50])} product forms")
        print(f"  - {len(self._build_ingredient_groups())} active ingredients")


def main():
    parser = argparse.ArgumentParser(
        description='Auto-update product grouping mappings from product data'
    )
    parser.add_argument(
        '--products-file',
        default='products.csv',
        help='Path to products CSV file (default: products.csv)'
    )
    parser.add_argument(
        '--output',
        default='go-backend/comprehensive_mappings.go',
        help='Output Go file path (default: go-backend/comprehensive_mappings.go)'
    )
    parser.add_argument(
        '--min-brand-count',
        type=int,
        default=10,
        help='Minimum product count to include brand (default: 10)'
    )

    args = parser.parse_args()

    # Resolve paths
    script_dir = Path(__file__).parent
    project_root = script_dir.parent

    products_file = project_root / args.products_file
    output_file = project_root / args.output

    if not products_file.exists():
        print(f"❌ Error: Products file not found: {products_file}")
        sys.exit(1)

    # Run extraction
    extractor = MappingExtractor(products_file, args.min_brand_count)
    extractor.analyze()
    extractor.write_mappings_file(output_file)

    print(f"\n✅ Done! Mappings updated in {output_file}")
    print(f"\n💡 Next steps:")
    print(f"  1. Review the generated mappings")
    print(f"  2. Test with: cd go-backend && go run test_grouping.go enhanced_grouping.go comprehensive_mappings.go")
    print(f"  3. Commit the updated mappings")


if __name__ == '__main__':
    main()
