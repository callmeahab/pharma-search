package main

// ComprehensiveMappings contains all variations extracted from 156K products
// Generated from actual product data analysis

// BuildBrandMap returns comprehensive brand name mappings (100 top brands)
func BuildBrandMap() map[string]string {
	return map[string]string{
		// Top brands with variations (from 156K products)
		"eucerin":    "Eucerin",
		"uriage":     "Uriage",
		"vichy":      "Vichy",
		"nivea":      "Nivea",
		"bioderma":   "Bioderma",
		"deborah":    "Deborah",
		"avene":      "Avene",
		"avène":      "Avene",
		"ziaja":      "Ziaja",
		"garnier":    "Garnier",
		"apivita":    "Apivita",
		"l'oreal":    "L'Oreal",
		"loreal":     "L'Oreal",
		"l'oréal":    "L'Oreal",
		"sebamed":    "Sebamed",
		"aura":       "Aura",
		"maybelline": "Maybelline",
		"curaprox":   "Curaprox",
		"chicco":     "Chicco",
		"hipp":       "Hipp",
		"solgar":     "Solgar",
		"schleich":   "Schleich",
		"golden":     "Golden Rose",
		"terranova":  "Terranova",
		"essence":    "Essence",
		"weleda":     "Weleda",
		"rimmel":     "Rimmel",
		"mustela":    "Mustela",
		"avent":      "Avent",
		"philips avent": "Avent",
		"noreva":     "Noreva",
		"now":        "Now Foods",
		"now foods":  "Now Foods",
		"natural wealth": "Natural Wealth",
		"cerave":     "CeraVe",
		"bourjois":   "Bourjois",
		"grubin":     "Grubin",
		"bivits":     "BiVits",
		"bivits activa": "BiVits",
		"bivits®":    "BiVits",
		"pampers":    "Pampers",
		"eveline":    "Eveline",
		"balea":      "Balea",
		"biokap":     "Biokap",
		"biofar":     "Biofar",
		"nuk":        "Nuk",
		"maxmedica":  "MaxMedica",
		"max medica": "MaxMedica",
		"nutrino":    "Nutrino",
		"a-derma":    "A-Derma",
		"opi":        "OPI",
		"dove":       "Dove",
		"velnea":     "Velnea",
		"canpol":     "Canpol",
		"canpol babies": "Canpol",
		"dmbio":      "DmBio",
		"dm bio":     "DmBio",
		"catrice":    "Catrice",
		"livsane":    "Livsane",
		"esi":        "ESI",
		"neutrogena": "Neutrogena",
		"mixa":       "Mixa",
		"lacalut":    "Lacalut",
		"becutan":    "Becutan",
		"siku":       "Siku",
		"kosili":     "Kosili",
		"krauterhof": "Krauterhof",
		"kräuterhof": "Krauterhof",
		"ducray":     "Ducray",
		"elfi":       "Elfi",
		"svr":        "SVR",
		"lerbolario": "L'Erbolario",
		"l'erbolario": "L'Erbolario",
		"rilastil":   "Rilastil",
		"pino":       "Pino",
		"biotech":    "BioTech",
		"biotech usa": "BioTech",
		"durex":      "Durex",
		"hedera":     "Hedera",
		"hedera vita": "Hedera Vita",
		"titania":    "Titania",
		"darphin":    "Darphin",
		"gorilla":    "Gorilla",
		"orthomol":   "Orthomol",
		"economic":   "Economic",
		"dietpharm":  "Dietpharm",
		"korres":     "Korres",
		"oral-b":     "Oral-B",
		"oral b":     "Oral-B",
		"nyx":        "NYX",
		"aptamil":    "Aptamil",
		"bibs":       "Bibs",
		"centrum":    "Centrum",
		"afrodita":   "Afrodita",
		"guam":       "Guam",
		"philips":    "Philips",
		"gillette":   "Gillette",
		"juvitana":   "Juvitana",
		"eterra":     "Eterra",
		"pierre":     "Pierre",
		"pierre fabre": "Pierre Fabre",
		"pantenol":   "Pantenol",
		"propomucil": "Propomucil",
		"la roche-posay": "La Roche-Posay",
		"la roche posay": "La Roche-Posay",
		"lrp":        "La Roche-Posay",
		"babytol":    "Babytol",
		"baby tol":   "Babytol",

		// Additional pharmaceutical brands
		"amix":       "Amix",
		"scitec":     "Scitec",
		"scitec nutrition": "Scitec",
		"optimum":    "Optimum Nutrition",
		"optimum nutrition": "Optimum Nutrition",
		"dymatize":   "Dymatize",
		"myprotein":  "MyProtein",
		"ultimate nutrition": "Ultimate Nutrition",
		"weider":     "Weider",
		"gnc":        "GNC",
		"qnt":        "QNT",
		"muscletech": "MuscleTech",
		"bsn":        "BSN",
		"cellucor":   "Cellucor",
		"nutrend":    "Nutrend",
	}
}

// BuildDosageUnitMap returns all dosage unit variations and their normalized forms
func BuildDosageUnitMap() map[string]string {
	return map[string]string{
		// Weight units (60K+ occurrences in data)
		"mg":  "mg",
		"g":   "g",
		"gr":  "g",
		"mcg": "mcg",
		"μg":  "mcg",
		"µg":  "mcg",
		"kg":  "kg",

		// IU units (800+ occurrences with variations)
		"iu":   "iu",
		"ie":   "iu",  // German/Serbian: Internationale Einheiten
		"ij":   "iu",  // Serbian: Internacionalne jedinice
		"i.j.": "iu",  // Serbian with dots

		// Volume units (60K+ occurrences)
		"ml": "ml",
		"l":  "l",
		"dl": "dl",

		// Percentage
		"%": "%",
	}
}

// BuildFormMap returns all product form variations (from 50K+ occurrences)
func BuildFormMap() map[string]string {
	return map[string]string{
		// Tablets (6,737 occurrences)
		"tablet":   "tablet",
		"tableta":  "tablet",  // Serbian
		"tablete":  "tablet",  // Serbian plural
		"tabl":     "tablet",
		"tbl":      "tablet",
		"ftbl":     "tablet",  // Film-coated tablet
		"šumeće":   "effervescent",  // Serbian: effervescent
		"šumeća":   "effervescent",
		"effervescent": "effervescent",

		// Capsules (9,736 occurrences)
		"capsule":  "capsule",
		"kapsula":  "capsule",  // Serbian
		"kapsul":   "capsule",  // Serbian
		"kapsule":  "capsule",  // Serbian plural
		"caps":     "capsule",
		"cap":      "capsule",
		"softgel":  "softgel",
		"gelcaps":  "softgel",
		"gelkaps":  "softgel",
		"gc":       "softgel",

		// Creams (10,190 occurrences)
		"krema":    "cream",  // Serbian
		"cream":    "cream",
		"krem":     "cream",  // Serbian variant

		// Gels (8,027 occurrences)
		"gel":      "gel",
		"gela":     "gel",

		// Lotions (2,065 occurrences)
		"losion":   "lotion",  // Serbian
		"lotion":   "lotion",
		"mleko":    "lotion",  // Serbian: milk/lotion

		// Sprays (3,842 occurrences)
		"sprej":    "spray",  // Serbian
		"spray":    "spray",

		// Powders (1,428 occurrences)
		"powder":   "powder",
		"prah":     "powder",  // Serbian
		"prašak":   "powder",  // Serbian

		// Liquids (1,734 occurrences)
		"kapi":     "drops",  // Serbian
		"drops":    "drops",
		"sirup":    "syrup",  // Serbian
		"syrup":    "syrup",

		// Sachets (2,049 occurrences)
		"kesica":   "sachet",  // Serbian
		"sachet":   "sachet",
		"stick":    "sachet",

		// Other forms
		"mast":     "ointment",  // Serbian
		"ointment": "ointment",
		"balzam":   "balm",  // Serbian
		"balsam":   "balm",
		"balm":     "balm",
		"serum":    "serum",
		"maska":    "mask",  // Serbian
		"mask":     "mask",
		"šampon":   "shampoo",  // Serbian
		"shampoo":  "shampoo",
		"sapun":    "soap",  // Serbian
		"soap":     "soap",
	}
}

// BuildActiveIngredientMap returns comprehensive ingredient mappings
// Based on analysis of supplement contexts from 156K products
func BuildActiveIngredientMap() map[string][]string {
	return map[string][]string{
		// Vitamin D (736 products)
		"vitamin_d": {
			"vitamin d3", "vitamin d 3", "vitamin d-3", "vitamind3",
			"vitamin d", "cholecalciferol", "d3", "d 3",
			"holekalciferol",  // Serbian variant
		},

		// Vitamin C (1,277 products)
		"vitamin_c": {
			"vitamin c", "vitamin c+", "vitaminc",
			"ascorbic acid", "askorbinska", "askorbinska kiselina",
			"cevital",  // Popular Serbian brand that indicates Vitamin C
		},

		// Vitamin E
		"vitamin_e": {
			"vitamin e", "vitamin e+", "vitamine",
			"tocopherol", "tokoferol",  // Serbian
		},

		// Vitamin A
		"vitamin_a": {
			"vitamin a", "vitamina",
			"retinol", "retinol palmitate",
		},

		// Vitamin K
		"vitamin_k": {
			"vitamin k", "vitamin k1", "vitamin k2",
			"phylloquinone", "menaquinone",
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

		// B Complex
		"b_complex": {
			"b complex", "b-complex", "b komplex",
			"vitamin b complex", "b vitamins",
		},

		// Multivitamin
		"multivitamin": {
			"multivitamin", "multi vitamin", "multi-vitamin",
			"polivitamin",  // Serbian
		},

		// Omega 3 (1,039 products)
		"omega_3": {
			"omega 3", "omega-3", "omega3", "omega 3+",
			"fish oil", "riblje ulje",  // Serbian
			"epa", "dha", "epa dha", "epa+dha",
			"omega boost", "omega vite",
		},

		// Omega 6
		"omega_6": {
			"omega 6", "omega-6", "omega6",
		},

		// Calcium (302 products)
		"calcium": {
			"calcium", "ca", "calcium+",
			"kalcijum",  // Serbian
			"calcium carbonate", "calcium citrate",
			"kalcijumkarbonat",  // Serbian
		},

		// Magnesium
		"magnesium": {
			"magnesium", "mg", "magnesium+",
			"magnezijum",  // Serbian
			"magnesium oxide", "magnesium citrate",
		},

		// Zinc
		"zinc": {
			"zinc", "zn", "zinc+",
			"cink",  // Serbian
			"zinc gluconate", "zinc picolinate", "zinc citrate",
		},

		// Iron
		"iron": {
			"iron", "fe",
			"gvožđe",  // Serbian
			"železo",  // Serbian
			"ferrous sulfate", "ferrous gluconate",
		},

		// Selenium
		"selenium": {
			"selenium", "se",
			"selen",  // Serbian
		},

		// Protein (1,891 products)
		"protein": {
			"protein", "whey", "casein",
			"proteinski",  // Serbian
			"protein powder", "whey protein", "casein protein",
			"isolate", "concentrate", "hydrolyzed",
		},

		// Creatine
		"creatine": {
			"creatine", "kreatin",  // Serbian
			"creatine monohydrate", "creatine hcl",
			"kre-alkalyn",
		},

		// BCAA
		"bcaa": {
			"bcaa", "branched chain amino acids",
			"bcaa+", "bcaa flow",
		},

		// EAA
		"eaa": {
			"eaa", "essential amino acids",
			"eaa+", "eaa zero",
		},

		// Glutamine
		"glutamine": {
			"glutamine", "glutamin",  // Serbian
			"l-glutamine", "l glutamine",
		},

		// Collagen
		"collagen": {
			"collagen", "kolagen",  // Serbian
			"collagen peptides", "hydrolyzed collagen",
			"peptan",
		},

		// CoQ10
		"coq10": {
			"coq10", "co q10", "co-q10", "q10",
			"coenzyme q10", "ubiquinol", "ubiquinone",
			"koenzim q10",  // Serbian
		},

		// Probiotics
		"probiotic": {
			"probiotic", "probiotik",  // Serbian
			"probiotics", "lactobacillus", "bifidobacterium",
		},

		// Glucosamine
		"glucosamine": {
			"glucosamine", "glukozamin",  // Serbian
			"glucosamine sulfate", "glucosamine hcl",
		},

		// Chondroitin
		"chondroitin": {
			"chondroitin", "hondroitin",  // Serbian
			"chondroitin sulfate",
		},

		// Hyaluronic Acid
		"hyaluronic": {
			"hyaluronic", "hyaluronic acid", "hyaluron",
			"hijaluronska",  // Serbian
		},
	}
}

// BuildQuantityPatterns returns regex patterns for quantity extraction
func GetQuantityKeywords() []string {
	return []string{
		"kom",      // Serbian: pieces
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
		"sachet",
		"sachets",
	}
}
