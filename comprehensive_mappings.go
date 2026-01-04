package main

// ComprehensiveMappings contains all variations extracted from 201K products
// Generated from Aposteka_processed.xlsx data analysis

// BuildBrandMap returns comprehensive brand name mappings (150+ top brands)
func BuildBrandMap() map[string]string {
	return map[string]string{
		// Top brands from 201K products (sorted by frequency)
		"eucerin":            "Eucerin",
		"uriage":             "Uriage",
		"vichy":              "Vichy",
		"nivea":              "Nivea",
		"bioderma":           "Bioderma",
		"garnier":            "Garnier",
		"ziaja":              "Ziaja",
		"deborah":            "Deborah",
		"l'oreal":            "L'Oreal",
		"loreal":             "L'Oreal",
		"l'oréal":            "L'Oreal",
		"maybelline":         "Maybelline",
		"avene":              "Avene",
		"avène":              "Avene",
		"apivita":            "Apivita",
		"aura":               "Aura",
		"sebamed":            "Sebamed",
		"solgar":             "Solgar",
		"golden":             "Golden Rose",
		"golden rose":        "Golden Rose",
		"curaprox":           "Curaprox",
		"hipp":               "Hipp",
		"rimmel":             "Rimmel",
		"natural wealth":     "Natural Wealth",
		"terranova":          "Terranova",
		"chicco":             "Chicco",
		"bourjois":           "Bourjois",
		"weleda":             "Weleda",
		"schleich":           "Schleich",
		"noreva":             "Noreva",
		"now":                "Now Foods",
		"now foods":          "Now Foods",
		"avent":              "Avent",
		"philips avent":      "Avent",
		"essence":            "Essence",
		"mustela":            "Mustela",
		"cerave":             "CeraVe",
		"eveline":            "Eveline",
		"opi":                "OPI",
		"livsane":            "Livsane",
		"biofar":             "Biofar",
		"bivits":             "BiVits",
		"bivits activa":      "BiVits",
		"nutrino":            "Nutrino",
		"biokap":             "Biokap",
		"esi":                "ESI",
		"grubin":             "Grubin",
		"pampers":            "Pampers",
		"maxmedica":          "MaxMedica",
		"max medica":         "MaxMedica",
		"gorilla":            "Gorilla",
		"balea":              "Balea",
		"economic":           "Economic",
		"a-derma":            "A-Derma",
		"velnea":             "Velnea",
		"dove":               "Dove",
		"catrice":            "Catrice",
		"nuk":                "Nuk",
		"ostrovit":           "OstroVit",
		"neutrogena":         "Neutrogena",
		"titania":            "Titania",
		"lerbolario":         "L'Erbolario",
		"l'erbolario":        "L'Erbolario",
		"orthomol":           "Orthomol",
		"kosili":             "Kosili",
		"mixa":               "Mixa",
		"dmbio":              "DmBio",
		"dm bio":             "DmBio",
		"lacalut":            "Lacalut",
		"krauterhof":         "Krauterhof",
		"kräuterhof":         "Krauterhof",
		"canpol":             "Canpol",
		"canpol babies":      "Canpol",
		"ducray":             "Ducray",
		"dietpharm":          "Dietpharm",
		"becutan":            "Becutan",
		"hedera":             "Hedera",
		"hedera vita":        "Hedera Vita",
		"siku":               "Siku",
		"philips":            "Philips",
		"afrodita":           "Afrodita",
		"elfi":               "Elfi",
		"svr":                "SVR",
		"dior":               "Dior",
		"biotech":            "BioTech",
		"biotech usa":        "BioTech",
		"essie":              "Essie",
		"guam":               "Guam",
		"durex":              "Durex",
		"oral-b":             "Oral-B",
		"oral b":             "Oral-B",
		"syoss":              "Syoss",
		"nutriversum":        "Nutriversum",
		"rilastil":           "Rilastil",
		"centrum":            "Centrum",
		"pino":               "Pino",
		"pierre":             "Pierre Fabre",
		"pierre fabre":       "Pierre Fabre",
		"gillette":           "Gillette",
		"darphin":            "Darphin",
		"satisfyer":          "Satisfyer",
		"la roche-posay":     "La Roche-Posay",
		"la roche posay":     "La Roche-Posay",
		"lrp":                "La Roche-Posay",
		"babytol":            "Babytol",
		"baby tol":           "Babytol",
		"nyx":                "NYX",
		"aptamil":            "Aptamil",
		"bibs":               "Bibs",
		"korres":             "Korres",
		"juvitana":           "Juvitana",
		"eterra":             "Eterra",
		"pantenol":           "Pantenol",
		"propomucil":         "Propomucil",
		"venum":              "Venum",

		// Sports nutrition brands
		"amix":               "Amix",
		"scitec":             "Scitec",
		"scitec nutrition":   "Scitec",
		"optimum":            "Optimum Nutrition",
		"optimum nutrition":  "Optimum Nutrition",
		"dymatize":           "Dymatize",
		"myprotein":          "MyProtein",
		"ultimate nutrition": "Ultimate Nutrition",
		"weider":             "Weider",
		"gnc":                "GNC",
		"qnt":                "QNT",
		"muscletech":         "MuscleTech",
		"bsn":                "BSN",
		"cellucor":           "Cellucor",
		"nutrend":            "Nutrend",
	}
}

// BuildDosageUnitMap returns all dosage unit variations and their normalized forms
func BuildDosageUnitMap() map[string]string {
	return map[string]string{
		// Weight units (from 201K products)
		"mg":   "mg",
		"g":    "g",
		"gr":   "g",   // Serbian variant (1514 occurrences)
		"mcg":  "mcg",
		"μg":   "mcg",
		"µg":   "mcg",
		"kg":   "kg",  // 2291 occurrences

		// IU units
		"iu":   "iu",
		"ie":   "iu",  // German/Serbian: Internationale Einheiten
		"ij":   "iu",  // Serbian: Internacionalne jedinice
		"i.j.": "iu",  // Serbian with dots

		// Volume units (74K+ occurrences)
		"ml": "ml",
		"l":  "l",   // 1112 occurrences
		"dl": "dl",

		// Count units
		"kom": "pcs", // Serbian: komad (919 occurrences)
		"pcs": "pcs",
		"pc":  "pcs",

		// Percentage
		"%": "%",
	}
}

// BuildFormMap returns all product form variations (from 201K products)
func BuildFormMap() map[string]string {
	return map[string]string{
		// Tablets (8946 occurrences)
		"tablet":      "tablet",
		"tableta":     "tablet",  // Serbian (5814)
		"tablete":     "tablet",  // Serbian plural (3132)
		"tabl":        "tablet",
		"tbl":         "tablet",
		"ftbl":        "tablet",  // Film-coated

		// Effervescent
		"šumeće":      "effervescent",
		"šumeća":      "effervescent",
		"effervescent": "effervescent",

		// Capsules (12952 occurrences)
		"capsule":     "capsule",
		"kapsula":     "capsule",  // Serbian (8848)
		"kapsule":     "capsule",  // Serbian plural (4104)
		"caps":        "capsule",  // (855)
		"cap":         "capsule",
		"capsules":    "capsule",
		"softgel":     "softgel",
		"gelcaps":     "softgel",
		"gelkaps":     "softgel",

		// Creams (14578 occurrences)
		"krema":       "cream",  // Serbian (11839)
		"krem":        "cream",  // Serbian variant (1623)
		"cream":       "cream",  // (1116)

		// Gels (9946 occurrences)
		"gel":         "gel",
		"gela":        "gel",

		// Lotions (2660 occurrences)
		"losion":      "lotion",  // Serbian (2451)
		"lotion":      "lotion",  // (209)
		"mleko":       "lotion",  // Serbian: milk/lotion (1648)

		// Sprays (4220 occurrences)
		"sprej":       "spray",  // Serbian (3888)
		"spray":       "spray",  // (332)

		// Powders (774 occurrences)
		"powder":      "powder",  // (413)
		"prah":        "powder",  // Serbian (361)
		"prašak":      "powder",

		// Drops (2121 occurrences)
		"kapi":        "drops",  // Serbian (2039)
		"drops":       "drops",  // (82)

		// Syrups (1484 occurrences)
		"sirup":       "syrup",  // Serbian
		"syrup":       "syrup",

		// Sachets (4170 occurrences)
		"kesica":      "sachet",  // Serbian (3077)
		"kesice":      "sachet",  // Serbian plural (1093)
		"sachet":      "sachet",
		"stick":       "sachet",  // (244)

		// Ointments (750 occurrences)
		"mast":        "ointment",  // Serbian
		"ointment":    "ointment",

		// Balms (2449 occurrences)
		"balzam":      "balm",  // Serbian (2242)
		"balsam":      "balm",  // (207)
		"balm":        "balm",

		// Serums (2733 occurrences)
		"serum":       "serum",

		// Masks (2526 occurrences)
		"maska":       "mask",  // Serbian (2279)
		"mask":        "mask",  // (247)

		// Shampoos (174 occurrences)
		"šampon":      "shampoo",  // Serbian
		"shampoo":     "shampoo",

		// Soaps (1213 occurrences)
		"sapun":       "soap",  // Serbian (1169)
		"soap":        "soap",

		// Oils (4976 occurrences)
		"ulje":        "oil",  // Serbian (3806)
		"oil":         "oil",  // (1170)

		// Pastes (2144 occurrences)
		"pasta":       "paste",

		// Solutions (1021 occurrences)
		"rastvor":     "solution",  // Serbian (916)
		"solution":    "solution",

		// Foams (919 occurrences)
		"pena":        "foam",  // Serbian (863)
		"foam":        "foam",

		// Emulsions (416 occurrences)
		"emulzija":    "emulsion",  // Serbian
		"emulsion":    "emulsion",

		// Ampoules (557 occurrences)
		"ampula":      "ampoule",  // Serbian (216)
		"ampule":      "ampoule",  // Serbian plural (341)
		"ampoule":     "ampoule",

		// Roll-ons (624 occurrences)
		"roll-on":     "roll-on",
		"rollon":      "roll-on",

		// Tinctures (38 occurrences)
		"tinktura":    "tincture",
		"tincture":    "tincture",

		// Suspensions (63 occurrences)
		"suspenzija":  "suspension",

		// Tea (324 occurrences)
		"čaj":         "tea",
		"tea":         "tea",
	}
}

// BuildActiveIngredientMap returns comprehensive ingredient mappings
// Based on analysis of 201K products
func BuildActiveIngredientMap() map[string][]string {
	return map[string][]string{
		// Protein (1775 products)
		"protein": {
			"protein", "whey", "casein", "isolate", "concentrate",
			"hydrolyzed", "proteinski",
		},

		// Vitamin C (1596 products)
		"vitamin_c": {
			"vitamin c", "vitamin c+", "vitaminc",
			"ascorbic acid", "askorbinska", "askorbinska kiselina",
			"cevital",
		},

		// Whey (1337 products)
		"whey": {
			"whey", "whey protein", "whey isolate", "whey concentrate",
		},

		// Hyaluronic Acid (1131 products)
		"hyaluronic": {
			"hyaluronic", "hyaluronic acid", "hyaluron", "ha",
			"hijaluronska", "hijaluron",
		},

		// Collagen (1486 products combined)
		"collagen": {
			"collagen", "kolagen", "collagen peptides", "hydrolyzed collagen",
			"peptan", "marine collagen",
		},

		// Magnesium (1417 products combined)
		"magnesium": {
			"magnesium", "magnezijum", "mg",
			"magnesium oxide", "magnesium citrate", "magnesium bisglycinate",
		},

		// CoQ10 (1128 products combined)
		"coq10": {
			"coq10", "co q10", "co-q10", "q10",
			"coenzyme q10", "ubiquinol", "ubiquinone",
			"koenzim q10", "koenzim",
		},

		// Zinc (989 products combined)
		"zinc": {
			"zinc", "zn", "zinc+", "cink",
			"zinc gluconate", "zinc picolinate", "zinc citrate",
		},

		// Vitamin D (944 products combined)
		// Note: "d3" and "d 3" removed - too generic, causes false matches (e.g., "od 3" in Serbian)
		"vitamin_d": {
			"vitamin d3", "vitamin d 3", "vitamin d-3", "vitamind3",
			"vitamin d", "cholecalciferol", "vit d", "vit. d",
			"holekalciferol", "devitin", "vigantol", "d3 vitamin",
		},

		// BCAA (489 products)
		"bcaa": {
			"bcaa", "branched chain amino acids",
			"bcaa+", "bcaa flow", "bcaa zero",
		},

		// Omega 3 (449 products)
		"omega_3": {
			"omega 3", "omega-3", "omega3", "omega 3+",
			"fish oil", "riblje ulje",
			"epa", "dha", "epa dha", "epa+dha",
		},

		// Panthenol (589 products combined)
		"panthenol": {
			"pantenol", "panthenol", "d-panthenol", "dexpanthenol",
			"provitamin b5",
		},

		// Creatine (420 products)
		"creatine": {
			"creatine", "kreatin",
			"creatine monohydrate", "creatine hcl",
			"kre-alkalyn",
		},

		// Selenium (563 products combined)
		"selenium": {
			"selenium", "se", "selen",
			"selenomethionine",
		},

		// Propolis (382 products)
		"propolis": {
			"propolis", "propolis+", "bee propolis",
		},

		// Melatonin (335 products)
		"melatonin": {
			"melatonin", "melatonin+",
		},

		// Probiotics (513 products combined)
		"probiotic": {
			"probiotic", "probiotik", "probiotics",
			"lactobacillus", "bifidobacterium", "acidophilus",
		},

		// Calcium (480 products combined)
		"calcium": {
			"calcium", "ca", "calcium+", "kalcijum",
			"calcium carbonate", "calcium citrate",
		},

		// Vitamin E (273 products)
		"vitamin_e": {
			"vitamin e", "vitamin e+", "vitamine",
			"tocopherol", "tokoferol",
		},

		// Retinol (231 products)
		"retinol": {
			"retinol", "retinol+", "vitamin a",
			"retinol palmitate", "retinoid",
		},

		// Glutamine (225 products)
		"glutamine": {
			"glutamine", "glutamin",
			"l-glutamine", "l glutamine",
		},

		// Iron (215 products)
		"iron": {
			"iron", "fe", "gvožđe", "železo",
			"ferrous sulfate", "ferrous gluconate", "ferric",
		},

		// L-Carnitine (206 products)
		"carnitine": {
			"l-carnitine", "l carnitine", "carnitine",
			"l-karnitin", "karnitin",
		},

		// Turmeric/Curcumin (191 products)
		"turmeric": {
			"kurkuma", "turmeric", "curcumin",
			"curcumin+", "turmeric root",
		},

		// Ashwagandha (180 products)
		"ashwagandha": {
			"ashwagandha", "withania somnifera",
			"ksm-66", "sensoril",
		},

		// Biotin (130 products)
		"biotin": {
			"biotin", "vitamin b7", "vitamin h",
		},

		// Arginine (128 products)
		"arginine": {
			"arginine", "arginin", "l-arginine", "l arginine",
		},

		// Glucosamine (132 products)
		"glucosamine": {
			"glucosamine", "glukozamin",
			"glucosamine sulfate", "glucosamine hcl",
		},

		// Chondroitin
		"chondroitin": {
			"chondroitin", "hondroitin",
			"chondroitin sulfate",
		},

		// B Complex
		"b_complex": {
			"b complex", "b-complex", "b komplex",
			"vitamin b complex", "b vitamins",
		},

		// Vitamin B12
		"vitamin_b12": {
			"vitamin b12", "vitamin b 12", "vitamin b-12",
			"b12", "b 12", "b-12",
			"cobalamin", "cyanocobalamin", "methylcobalamin",
		},

		// Vitamin B6
		"vitamin_b6": {
			"vitamin b6", "vitamin b 6", "vitamin b-6",
			"b6", "pyridoxine",
		},

		// Multivitamin
		"multivitamin": {
			"multivitamin", "multi vitamin", "multi-vitamin",
			"polivitamin", "multivitamini",
		},

		// Niacinamide (skincare)
		"niacinamide": {
			"niacinamide", "niacinamid", "nicotinamide",
			"vitamin b3",
		},

		// Taurine
		"taurine": {
			"taurin", "taurine", "l-taurine",
		},

		// Spirulina
		"spirulina": {
			"spirulina", "spirulina+",
		},

		// Chlorella
		"chlorella": {
			"chlorella", "chlorela",
		},

		// Echinacea
		"echinacea": {
			"echinacea", "ehinacea", "echinacea+",
		},

		// Ginseng
		"ginseng": {
			"ginseng", "panax ginseng", "korean ginseng",
			"siberian ginseng",
		},

		// EAA
		"eaa": {
			"eaa", "essential amino acids",
			"eaa+", "eaa zero",
		},
	}
}

// GetQuantityKeywords returns keywords indicating quantity
func GetQuantityKeywords() []string {
	return []string{
		"kom",       // Serbian: pieces (919 occurrences)
		"pcs",
		"pc",
		"pieces",
		"tableta",
		"tablete",
		"kapsula",
		"kapsule",
		"caps",
		"tablets",
		"capsules",
		"kesica",
		"kesice",
		"sachet",
		"sachets",
		"ampula",
		"ampule",
	}
}
