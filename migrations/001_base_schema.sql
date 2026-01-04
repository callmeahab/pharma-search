-- Migration: 001_base_schema
-- Simplified schema with 4 core tables

-- Vendor table (pharmacies/stores)
CREATE TABLE public."Vendor" (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    name text NOT NULL,
    logo text,
    website text,
    "scraperFile" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "Vendor_pkey" PRIMARY KEY (id),
    CONSTRAINT "Vendor_name_key" UNIQUE (name)
);

-- ProductGroup table (for price comparison grouping)
CREATE TABLE public."ProductGroup" (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    "normalizedName" text NOT NULL,
    "groupKey" text NOT NULL,
    "productCount" integer DEFAULT 0 NOT NULL,
    "vendorCount" integer DEFAULT 0,
    "minPrice" numeric(10,2),
    "maxPrice" numeric(10,2),
    "avgPrice" numeric(10,2),
    "coreProductIdentity" text,
    "categoryType" varchar(100) DEFAULT 'other',
    "coreIngredient" varchar(200),
    "formType" varchar(50),
    "dosageValue" numeric(15,6),
    "dosageUnit" text,
    "qualityScore" numeric(3,2) DEFAULT 0.0,
    "isActive" boolean DEFAULT true,
    "groupName" varchar(500),
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "ProductGroup_pkey" PRIMARY KEY (id),
    CONSTRAINT "ProductGroup_groupKey_key" UNIQUE ("groupKey")
);
COMMENT ON TABLE public."ProductGroup" IS 'Groups similar products for price comparison';

-- Product table (main product data)
CREATE TABLE public."Product" (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    "vendorId" text NOT NULL,
    title text NOT NULL,
    price double precision NOT NULL,
    link text NOT NULL,
    thumbnail text NOT NULL,
    photos text NOT NULL,
    description text,

    -- Extracted/normalized fields (text, no FKs)
    "normalizedName" text,
    "extractedBrand" text,
    "productLine" text,
    category text,
    form text,

    -- Dosage info
    "dosageValue" numeric(15,6),
    "dosageUnit" text,
    "dosageText" text,

    -- Volume info
    "volumeValue" numeric(15,6),
    "volumeUnit" text,
    "volumeText" text,

    -- Quantity info
    "quantityValue" integer,
    "quantityUnit" text,

    -- Other extracted fields
    "spfValue" integer,
    variant text,
    size text,

    -- Grouping fields
    "productGroupId" text,
    "coreProductIdentity" text,
    "computedGroupId" varchar(100),
    "groupingConfidence" numeric(3,2) DEFAULT 0.0,
    "groupingMethod" varchar(50),

    -- Search fields
    "searchTokens" text[],
    "keywordTags" text[],

    -- Processing status
    "processedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY (id),
    CONSTRAINT "Product_title_vendorId_key" UNIQUE (title, "vendorId"),
    CONSTRAINT "Product_vendorId_fkey" FOREIGN KEY ("vendorId")
        REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "Product_productGroupId_fkey" FOREIGN KEY ("productGroupId")
        REFERENCES public."ProductGroup"(id) ON UPDATE CASCADE ON DELETE SET NULL
);
COMMENT ON TABLE public."Product" IS 'Product listings from pharmacies';
