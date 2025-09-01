--
-- PostgreSQL database dump
--

-- Dumped from database version 17.5 (Postgres.app)
-- Dumped by pg_dump version 17.5 (Postgres.app)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: btree_gin; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gin WITH SCHEMA public;


--
-- Name: EXTENSION btree_gin; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION btree_gin IS 'support for indexing common datatypes in GIN';


--
-- Name: fuzzystrmatch; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA public;


--
-- Name: EXTENSION fuzzystrmatch; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION fuzzystrmatch IS 'determine similarities and distance between strings';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: convert_to_normalized_unit(numeric, text); Type: FUNCTION; Schema: public; Owner: ahab
--

CREATE FUNCTION public.convert_to_normalized_unit(value numeric, unit_name text) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    conversion_factor DECIMAL;
    normalized_value DECIMAL;
BEGIN
    SELECT u."conversionFactor" INTO conversion_factor
    FROM "Unit" u 
    WHERE u."name" = unit_name 
       OR unit_name = ANY(u."aliases");
    
    IF conversion_factor IS NOT NULL THEN
        normalized_value := value * conversion_factor;
    ELSE
        normalized_value := value;
    END IF;
    
    RETURN normalized_value;
END;
$$;


ALTER FUNCTION public.convert_to_normalized_unit(value numeric, unit_name text) OWNER TO ahab;

--
-- Name: enhanced_product_search(text, numeric, numeric, text[], text[], text[], integer); Type: FUNCTION; Schema: public; Owner: ahab
--

CREATE FUNCTION public.enhanced_product_search(search_query text, min_price numeric DEFAULT NULL::numeric, max_price numeric DEFAULT NULL::numeric, vendor_filter text[] DEFAULT NULL::text[], brand_filter text[] DEFAULT NULL::text[], form_filter text[] DEFAULT NULL::text[], result_limit integer DEFAULT 100) RETURNS TABLE(id text, title text, price numeric, vendor_id text, vendor_name text, brand_name text, form_name text, dosage_text text, volume_text text, relevance_score integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
    cleaned_query TEXT;
    expanded_query TEXT;
BEGIN
    cleaned_query := LOWER(TRIM(search_query));
    expanded_query := expand_pharma_abbreviations(cleaned_query);
    
    RETURN QUERY
    SELECT 
        p.id,
        p.title,
        p.price::NUMERIC,
        p."vendorId"::TEXT,
        v.name::TEXT as vendor_name,
        COALESCE(b.name, p."extractedBrand", '')::TEXT as brand_name,
        COALESCE(pf.name, p.form, '')::TEXT as form_name,
        COALESCE(p."dosageText", '')::TEXT as dosage_text,
        COALESCE(p."volumeText", '')::TEXT as volume_text,
        (CASE 
            -- Exact title match
            WHEN LOWER(p.title) = cleaned_query THEN 5000
            -- Title starts with query
            WHEN p.title ILIKE (cleaned_query || '%') THEN 4500
            -- Exact token match
            WHEN cleaned_query = ANY(COALESCE(p."searchTokens", ARRAY[]::TEXT[])) THEN 4000
            -- Brand + product line match
            WHEN p."brandProductLine" ILIKE ('%' || cleaned_query || '%') THEN 3800
            -- Product line match
            WHEN p."productLine" ILIKE ('%' || cleaned_query || '%') THEN 3600
            -- High similarity
            WHEN similarity(LOWER(p.title), cleaned_query) > 0.4 THEN 
                (3000 + (similarity(LOWER(p.title), cleaned_query) * 1500))::int
            -- Word boundary match
            WHEN p.title ~* ('\m' || cleaned_query) THEN 3500
            -- Substring match in title
            WHEN p.title ILIKE ('%' || cleaned_query || '%') THEN 2500
            -- Normalized name match
            WHEN COALESCE(p."normalizedName", '') ILIKE ('%' || cleaned_query || '%') THEN 2000
            -- Brand match
            WHEN b.name ILIKE ('%' || cleaned_query || '%') OR 
                 p."extractedBrand" ILIKE ('%' || cleaned_query || '%') THEN 1500
            -- Form match
            WHEN pf.name ILIKE ('%' || cleaned_query || '%') OR 
                 p.form ILIKE ('%' || cleaned_query || '%') THEN 1200
            -- Keyword tags match
            WHEN cleaned_query = ANY(COALESCE(p."keywordTags", ARRAY[]::TEXT[])) THEN 1000
            -- Moderate similarity
            WHEN similarity(LOWER(p.title), cleaned_query) > 0.2 THEN 
                (500 + (similarity(LOWER(p.title), cleaned_query) * 500))::int
            ELSE 100
        END)::INTEGER as relevance_score
    FROM "Product" p
    JOIN "Vendor" v ON v.id = p."vendorId"
    LEFT JOIN "Brand" b ON p."brandId" = b.id
    LEFT JOIN "ProductForm" pf ON p."productFormId" = pf.id
    WHERE 
        (min_price IS NULL OR p.price >= min_price)
        AND (max_price IS NULL OR p.price <= max_price)
        AND (vendor_filter IS NULL OR p."vendorId" = ANY(vendor_filter))
        AND (brand_filter IS NULL OR p."brandId" = ANY(brand_filter) OR p."extractedBrand" = ANY(brand_filter))
        AND (form_filter IS NULL OR p."productFormId" = ANY(form_filter) OR p.form = ANY(form_filter))
        AND (
            -- Comprehensive search conditions
            LOWER(p.title) = cleaned_query OR
            p.title ILIKE (cleaned_query || '%') OR
            cleaned_query = ANY(COALESCE(p."searchTokens", ARRAY[]::TEXT[])) OR
            p."brandProductLine" ILIKE ('%' || cleaned_query || '%') OR
            p."productLine" ILIKE ('%' || cleaned_query || '%') OR
            similarity(LOWER(p.title), cleaned_query) > 0.15 OR
            p.title ~* ('\m' || cleaned_query) OR
            p.title ILIKE ('%' || cleaned_query || '%') OR
            COALESCE(p."normalizedName", '') ILIKE ('%' || cleaned_query || '%') OR
            b.name ILIKE ('%' || cleaned_query || '%') OR
            p."extractedBrand" ILIKE ('%' || cleaned_query || '%') OR
            pf.name ILIKE ('%' || cleaned_query || '%') OR
            p.form ILIKE ('%' || cleaned_query || '%') OR
            cleaned_query = ANY(COALESCE(p."keywordTags", ARRAY[]::TEXT[]))
        )
    ORDER BY relevance_score DESC, p.price ASC
    LIMIT result_limit;
END;
$$;


ALTER FUNCTION public.enhanced_product_search(search_query text, min_price numeric, max_price numeric, vendor_filter text[], brand_filter text[], form_filter text[], result_limit integer) OWNER TO ahab;

--
-- Name: expand_pharma_abbreviations(text); Type: FUNCTION; Schema: public; Owner: ahab
--

CREATE FUNCTION public.expand_pharma_abbreviations(query text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    expanded_query TEXT;
BEGIN
    expanded_query := LOWER(TRIM(query));
    
    -- Comprehensive pharmaceutical abbreviations based on CSV analysis
    expanded_query := CASE
        -- Vitamins
        WHEN expanded_query = 'vitc' THEN 'vitamin c'
        WHEN expanded_query = 'vitd' THEN 'vitamin d'
        WHEN expanded_query = 'vitb' THEN 'vitamin b'
        WHEN expanded_query = 'vit' THEN 'vitamin'
        WHEN expanded_query = 'd3' THEN 'vitamin d3'
        WHEN expanded_query = 'b12' THEN 'vitamin b12'
        WHEN expanded_query = 'k2' THEN 'vitamin k2'
        WHEN expanded_query = 'c' THEN 'vitamin c'
        
        -- Minerals
        WHEN expanded_query = 'calc' THEN 'calcium'
        WHEN expanded_query = 'mag' THEN 'magnesium'
        WHEN expanded_query = 'zn' THEN 'zinc'
        WHEN expanded_query = 'fe' THEN 'iron'
        WHEN expanded_query = 'ca' THEN 'calcium'
        WHEN expanded_query = 'mg' THEN 'magnesium'
        
        -- Supplements
        WHEN expanded_query = 'prob' THEN 'probiotic'
        WHEN expanded_query = 'omega3' THEN 'omega-3'
        WHEN expanded_query = 'coq10' THEN 'coenzyme q10'
        WHEN expanded_query = 'bcaa' THEN 'branched chain amino acids'
        
        -- Common product abbreviations from CSV
        WHEN expanded_query = 'aspir' THEN 'aspirator'
        WHEN expanded_query = 'antirozac' THEN 'antirozacea'
        WHEN expanded_query = 'probiotik' THEN 'probiotic'
        
        ELSE expanded_query
    END;
    
    RETURN expanded_query;
END;
$$;


ALTER FUNCTION public.expand_pharma_abbreviations(query text) OWNER TO ahab;

--
-- Name: fast_product_search(text, numeric, numeric, text[], integer); Type: FUNCTION; Schema: public; Owner: ahab
--

CREATE FUNCTION public.fast_product_search(search_query text, min_price numeric DEFAULT NULL::numeric, max_price numeric DEFAULT NULL::numeric, vendor_filter text[] DEFAULT NULL::text[], result_limit integer DEFAULT 100) RETURNS TABLE(id text, title text, price numeric, vendor_id text, vendor_name text, brand_name text, relevance_score integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
    cleaned_query TEXT;
    expanded_query TEXT;
BEGIN
    cleaned_query := LOWER(TRIM(search_query));
    expanded_query := expand_pharma_abbreviations(cleaned_query);
    
    RETURN QUERY
    SELECT 
        p.id,
        p.title,
        p.price::NUMERIC,
        p."vendorId"::TEXT,
        v.name::TEXT as vendor_name,
        COALESCE(b.name, '')::TEXT as brand_name,
        (CASE 
            WHEN LOWER(p.title) = cleaned_query THEN 5000
            WHEN p.title ILIKE (cleaned_query || '%') THEN 4500
            WHEN cleaned_query = ANY(COALESCE(p."searchTokens", ARRAY[]::TEXT[])) THEN 4000
            WHEN similarity(LOWER(p.title), cleaned_query) > 0.3 THEN 
                (3000 + (similarity(LOWER(p.title), cleaned_query) * 1000))::int
            WHEN p.title ~* ('\m' || cleaned_query) THEN 3500
            WHEN p.title ILIKE ('%' || cleaned_query || '%') THEN 2000
            WHEN COALESCE(p."normalizedName", '') ILIKE ('%' || cleaned_query || '%') THEN 1500
            WHEN b.name ILIKE ('%' || cleaned_query || '%') THEN 1000
            ELSE 100
        END)::INTEGER as relevance_score
    FROM "Product" p
    JOIN "Vendor" v ON v.id = p."vendorId"
    LEFT JOIN "Brand" b ON p."brandId" = b.id
    WHERE 
        (min_price IS NULL OR p.price >= min_price)
        AND (max_price IS NULL OR p.price <= max_price)
        AND (vendor_filter IS NULL OR p."vendorId" = ANY(vendor_filter))
        AND (
            LOWER(p.title) = cleaned_query OR
            p.title ILIKE (cleaned_query || '%') OR
            cleaned_query = ANY(COALESCE(p."searchTokens", ARRAY[]::TEXT[])) OR
            similarity(LOWER(p.title), cleaned_query) > 0.2 OR
            p.title ~* ('\m' || cleaned_query) OR
            p.title ILIKE ('%' || cleaned_query || '%') OR
            COALESCE(p."normalizedName", '') ILIKE ('%' || cleaned_query || '%') OR
            b.name ILIKE ('%' || cleaned_query || '%')
        )
    ORDER BY relevance_score DESC, p.price ASC
    LIMIT result_limit;
END;
$$;


ALTER FUNCTION public.fast_product_search(search_query text, min_price numeric, max_price numeric, vendor_filter text[], result_limit integer) OWNER TO ahab;

--
-- Name: normalize_unit(text); Type: FUNCTION; Schema: public; Owner: ahab
--

CREATE FUNCTION public.normalize_unit(unit_name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    normalized_unit TEXT;
BEGIN
    SELECT u."normalizedName" INTO normalized_unit
    FROM "Unit" u 
    WHERE u."name" = unit_name 
       OR unit_name = ANY(u."aliases");
    
    RETURN COALESCE(normalized_unit, unit_name);
END;
$$;


ALTER FUNCTION public.normalize_unit(unit_name text) OWNER TO ahab;

--
-- Name: update_group_stats(text); Type: FUNCTION; Schema: public; Owner: ahab
--

CREATE FUNCTION public.update_group_stats(group_id text) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE "ProductGroup" 
    SET 
        "productCount" = (SELECT COUNT(*) FROM "Product" WHERE "productGroupId" = group_id),
        "vendorCount" = (SELECT COUNT(DISTINCT "vendorId") FROM "Product" WHERE "productGroupId" = group_id),
        "minPrice" = (SELECT MIN(price) FROM "Product" WHERE "productGroupId" = group_id),
        "maxPrice" = (SELECT MAX(price) FROM "Product" WHERE "productGroupId" = group_id),
        "avgPrice" = (SELECT AVG(price) FROM "Product" WHERE "productGroupId" = group_id),
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE id = group_id;
END;
$$;


ALTER FUNCTION public.update_group_stats(group_id text) OWNER TO ahab;

--
-- Name: update_group_stats_trigger(); Type: FUNCTION; Schema: public; Owner: ahab
--

CREATE FUNCTION public.update_group_stats_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW."productGroupId" IS NOT NULL THEN
        PERFORM update_group_stats(NEW."productGroupId");
    ELSIF TG_OP = 'UPDATE' AND (OLD."productGroupId" != NEW."productGroupId" OR OLD.price != NEW.price) THEN
        IF OLD."productGroupId" IS NOT NULL THEN
            PERFORM update_group_stats(OLD."productGroupId");
        END IF;
        IF NEW."productGroupId" IS NOT NULL THEN
            PERFORM update_group_stats(NEW."productGroupId");
        END IF;
    ELSIF TG_OP = 'DELETE' AND OLD."productGroupId" IS NOT NULL THEN
        PERFORM update_group_stats(OLD."productGroupId");
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION public.update_group_stats_trigger() OWNER TO ahab;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: ahab
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO ahab;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Brand; Type: TABLE; Schema: public; Owner: ahab
--

CREATE TABLE public."Brand" (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    name text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "normalizedName" text,
    aliases text[],
    "productLines" text[]
);


ALTER TABLE public."Brand" OWNER TO ahab;

--
-- Name: TABLE "Brand"; Type: COMMENT; Schema: public; Owner: ahab
--

COMMENT ON TABLE public."Brand" IS 'Enhanced brands table with normalization and product lines';


--
-- Name: Category; Type: TABLE; Schema: public; Owner: ahab
--

CREATE TABLE public."Category" (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    name text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Category" OWNER TO ahab;

--
-- Name: GroupingRules; Type: TABLE; Schema: public; Owner: ahab
--

CREATE TABLE public."GroupingRules" (
    id integer NOT NULL,
    "ruleName" character varying(200) NOT NULL,
    "categoryType" character varying(100) NOT NULL,
    "ruleType" character varying(50) NOT NULL,
    "ruleData" text NOT NULL,
    priority integer DEFAULT 100,
    "isActive" boolean DEFAULT true,
    "createdAt" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public."GroupingRules" OWNER TO ahab;

--
-- Name: GroupingRules_id_seq; Type: SEQUENCE; Schema: public; Owner: ahab
--

CREATE SEQUENCE public."GroupingRules_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."GroupingRules_id_seq" OWNER TO ahab;

--
-- Name: GroupingRules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ahab
--

ALTER SEQUENCE public."GroupingRules_id_seq" OWNED BY public."GroupingRules".id;


--
-- Name: Product; Type: TABLE; Schema: public; Owner: ahab
--

CREATE TABLE public."Product" (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    "vendorId" text NOT NULL,
    price double precision NOT NULL,
    title text NOT NULL,
    "originalTitle" text,
    category text,
    link text NOT NULL,
    thumbnail text NOT NULL,
    photos text NOT NULL,
    description text,
    "normalizedName" text,
    "brandId" text,
    "unitId" text,
    "productGroupId" text,
    "dosageValue" numeric(15,6),
    "dosageUnit" text,
    strength text,
    form text,
    "searchTokens" text[],
    "searchVector" tsvector,
    embedding bytea,
    "coreProductIdentity" text,
    "processedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "extractedBrand" text,
    "productLine" text,
    "brandProductLine" text,
    "dosageNormalized" numeric(15,6),
    "dosageText" text,
    "volumeValue" numeric(15,6),
    "volumeUnit" text,
    "volumeNormalized" numeric(15,6),
    "volumeText" text,
    "quantityValue" integer,
    "quantityUnit" text,
    "quantityText" text,
    variant text,
    size text,
    "spfValue" integer,
    "specialCodes" text[],
    "multiplierPattern" text,
    "keywordTags" text[],
    "groupingKey" text,
    "similarityKey" text,
    "extractionConfidence" jsonb,
    "processingErrors" text[],
    "computedGroupId" character varying(100),
    "groupingConfidence" numeric(3,2) DEFAULT 0.0,
    "groupingMethod" character varying(50)
);


ALTER TABLE public."Product" OWNER TO ahab;

--
-- Name: TABLE "Product"; Type: COMMENT; Schema: public; Owner: ahab
--

COMMENT ON TABLE public."Product" IS 'Enhanced products table with comprehensive pharmaceutical attributes';


--
-- Name: COLUMN "Product".embedding; Type: COMMENT; Schema: public; Owner: ahab
--

COMMENT ON COLUMN public."Product".embedding IS 'Single ML embedding field for semantic similarity';


--
-- Name: COLUMN "Product"."coreProductIdentity"; Type: COMMENT; Schema: public; Owner: ahab
--

COMMENT ON COLUMN public."Product"."coreProductIdentity" IS 'Core product identity for grouping';


--
-- Name: ProductForm; Type: TABLE; Schema: public; Owner: ahab
--

CREATE TABLE public."ProductForm" (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    name text NOT NULL,
    "normalizedName" text NOT NULL,
    aliases text[],
    category text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."ProductForm" OWNER TO ahab;

--
-- Name: TABLE "ProductForm"; Type: COMMENT; Schema: public; Owner: ahab
--

COMMENT ON TABLE public."ProductForm" IS 'Pharmaceutical forms with aliases and categorization';


--
-- Name: ProductGroup; Type: TABLE; Schema: public; Owner: ahab
--

CREATE TABLE public."ProductGroup" (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    "normalizedName" text NOT NULL,
    "brandId" text,
    "dosageValue" numeric(15,6),
    "dosageUnit" text,
    "unitId" text,
    "groupKey" text NOT NULL,
    "productCount" integer DEFAULT 0 NOT NULL,
    "vendorCount" integer DEFAULT 0,
    "minPrice" numeric(10,2),
    "maxPrice" numeric(10,2),
    "avgPrice" numeric(10,2),
    "coreProductIdentity" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "categoryType" character varying(100) DEFAULT 'other'::character varying,
    "coreIngredient" character varying(200),
    "formType" character varying(50),
    "brandFamily" character varying(100),
    "packageSize" integer,
    "dosageStrength" numeric(10,3),
    "groupingRules" text,
    "qualityScore" numeric(3,2) DEFAULT 0.0,
    "lastUpdated" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    "isActive" boolean DEFAULT true,
    "groupName" character varying(500)
);


ALTER TABLE public."ProductGroup" OWNER TO ahab;

--
-- Name: TABLE "ProductGroup"; Type: COMMENT; Schema: public; Owner: ahab
--

COMMENT ON TABLE public."ProductGroup" IS 'Enhanced product grouping with detailed pharmaceutical categorization';


--
-- Name: ProductGroupAnalysis; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public."ProductGroupAnalysis" AS
 SELECT pg.id AS group_id,
    pg."groupName",
    pg."categoryType",
    pg."productCount",
    pg."vendorCount",
    pg."qualityScore",
    count(p.id) AS actual_product_count,
    count(DISTINCT p."vendorId") AS actual_vendor_count,
    min(p.price) AS actual_min_price,
    max(p.price) AS actual_max_price,
    avg(p.price) AS actual_avg_price
   FROM (public."ProductGroup" pg
     LEFT JOIN public."Product" p ON (((p."computedGroupId")::text = pg.id)))
  WHERE (pg."isActive" = true)
  GROUP BY pg.id, pg."groupName", pg."categoryType", pg."productCount", pg."vendorCount", pg."qualityScore";


ALTER VIEW public."ProductGroupAnalysis" OWNER TO postgres;

--
-- Name: Unit; Type: TABLE; Schema: public; Owner: ahab
--

CREATE TABLE public."Unit" (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    name text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "normalizedName" text,
    aliases text[],
    type text,
    "baseUnit" text,
    "conversionFactor" numeric(15,6)
);


ALTER TABLE public."Unit" OWNER TO ahab;

--
-- Name: TABLE "Unit"; Type: COMMENT; Schema: public; Owner: ahab
--

COMMENT ON TABLE public."Unit" IS 'Comprehensive unit normalization table with conversion factors';


--
-- Name: User; Type: TABLE; Schema: public; Owner: ahab
--

CREATE TABLE public."User" (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."User" OWNER TO ahab;

--
-- Name: Vendor; Type: TABLE; Schema: public; Owner: ahab
--

CREATE TABLE public."Vendor" (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    name text NOT NULL,
    logo text,
    website text,
    "scraperFile" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Vendor" OWNER TO ahab;

--
-- Name: price_comparison; Type: VIEW; Schema: public; Owner: ahab
--

CREATE VIEW public.price_comparison AS
 SELECT p.id,
    p.title,
    p.price,
    v.name AS vendor_name,
    b.name AS brand_name,
    p."productGroupId",
    pg."normalizedName" AS group_name,
    pg."minPrice" AS group_min_price,
    pg."maxPrice" AS group_max_price,
    pg."avgPrice" AS group_avg_price
   FROM (((public."Product" p
     JOIN public."Vendor" v ON ((p."vendorId" = v.id)))
     LEFT JOIN public."Brand" b ON ((p."brandId" = b.id)))
     LEFT JOIN public."ProductGroup" pg ON ((p."productGroupId" = pg.id)))
  WHERE (p."processedAt" IS NOT NULL);


ALTER VIEW public.price_comparison OWNER TO ahab;

--
-- Name: VIEW price_comparison; Type: COMMENT; Schema: public; Owner: ahab
--

COMMENT ON VIEW public.price_comparison IS 'View optimized for price comparison queries';


--
-- Name: product_groups; Type: VIEW; Schema: public; Owner: ahab
--

CREATE VIEW public.product_groups AS
 SELECT pg.id,
    pg."normalizedName",
    pg."groupKey",
    pg."productCount",
    pg."vendorCount",
    pg."minPrice",
    pg."maxPrice",
    pg."avgPrice",
    b.name AS brand_name
   FROM (public."ProductGroup" pg
     LEFT JOIN public."Brand" b ON ((pg."brandId" = b.id)))
  WHERE (pg."productCount" > 0);


ALTER VIEW public.product_groups OWNER TO ahab;

--
-- Name: VIEW product_groups; Type: COMMENT; Schema: public; Owner: ahab
--

COMMENT ON VIEW public.product_groups IS 'Simple view for basic product grouping queries';


--
-- Name: GroupingRules id; Type: DEFAULT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."GroupingRules" ALTER COLUMN id SET DEFAULT nextval('public."GroupingRules_id_seq"'::regclass);


--
-- Name: Brand Brand_name_key; Type: CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."Brand"
    ADD CONSTRAINT "Brand_name_key" UNIQUE (name);


--
-- Name: Brand Brand_pkey; Type: CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."Brand"
    ADD CONSTRAINT "Brand_pkey" PRIMARY KEY (id);


--
-- Name: Category Category_name_key; Type: CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."Category"
    ADD CONSTRAINT "Category_name_key" UNIQUE (name);


--
-- Name: Category Category_pkey; Type: CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."Category"
    ADD CONSTRAINT "Category_pkey" PRIMARY KEY (id);


--
-- Name: GroupingRules GroupingRules_pkey; Type: CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."GroupingRules"
    ADD CONSTRAINT "GroupingRules_pkey" PRIMARY KEY (id);


--
-- Name: ProductForm ProductForm_name_key; Type: CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."ProductForm"
    ADD CONSTRAINT "ProductForm_name_key" UNIQUE (name);


--
-- Name: ProductForm ProductForm_pkey; Type: CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."ProductForm"
    ADD CONSTRAINT "ProductForm_pkey" PRIMARY KEY (id);


--
-- Name: ProductGroup ProductGroup_groupKey_key; Type: CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."ProductGroup"
    ADD CONSTRAINT "ProductGroup_groupKey_key" UNIQUE ("groupKey");


--
-- Name: ProductGroup ProductGroup_pkey; Type: CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."ProductGroup"
    ADD CONSTRAINT "ProductGroup_pkey" PRIMARY KEY (id);


--
-- Name: Product Product_pkey; Type: CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."Product"
    ADD CONSTRAINT "Product_pkey" PRIMARY KEY (id);


--
-- Name: Product Product_title_vendorId_key; Type: CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."Product"
    ADD CONSTRAINT "Product_title_vendorId_key" UNIQUE (title, "vendorId");


--
-- Name: Unit Unit_name_key; Type: CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."Unit"
    ADD CONSTRAINT "Unit_name_key" UNIQUE (name);


--
-- Name: Unit Unit_pkey; Type: CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."Unit"
    ADD CONSTRAINT "Unit_pkey" PRIMARY KEY (id);


--
-- Name: User User_email_key; Type: CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_email_key" UNIQUE (email);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: Vendor Vendor_name_key; Type: CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."Vendor"
    ADD CONSTRAINT "Vendor_name_key" UNIQUE (name);


--
-- Name: Vendor Vendor_pkey; Type: CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."Vendor"
    ADD CONSTRAINT "Vendor_pkey" PRIMARY KEY (id);


--
-- Name: idx_brand_name; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_brand_name ON public."Brand" USING btree (name);


--
-- Name: idx_brand_name_lower; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_brand_name_lower ON public."Brand" USING btree (lower(name));


--
-- Name: idx_brand_name_trgm; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_brand_name_trgm ON public."Brand" USING gin (name public.gin_trgm_ops);


--
-- Name: idx_product_brand; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_brand ON public."Product" USING btree ("brandId") WHERE ("brandId" IS NOT NULL);


--
-- Name: idx_product_brand_price; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_brand_price ON public."Product" USING btree ("brandId", price) WHERE ("brandId" IS NOT NULL);


--
-- Name: idx_product_brand_product_line; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_brand_product_line ON public."Product" USING btree ("brandProductLine") WHERE ("brandProductLine" IS NOT NULL);


--
-- Name: idx_product_category; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_category ON public."Product" USING btree (category) WHERE (category IS NOT NULL);


--
-- Name: idx_product_computed_group; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_computed_group ON public."Product" USING btree ("computedGroupId");


--
-- Name: idx_product_core_identity; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_core_identity ON public."Product" USING btree ("coreProductIdentity") WHERE ("coreProductIdentity" IS NOT NULL);


--
-- Name: idx_product_dosage_normalized; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_dosage_normalized ON public."Product" USING btree ("dosageNormalized") WHERE ("dosageNormalized" IS NOT NULL);


--
-- Name: idx_product_dosage_unit; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_dosage_unit ON public."Product" USING btree ("dosageUnit") WHERE ("dosageUnit" IS NOT NULL);


--
-- Name: idx_product_dosage_value; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_dosage_value ON public."Product" USING btree ("dosageValue") WHERE ("dosageValue" IS NOT NULL);


--
-- Name: idx_product_extracted_brand; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_extracted_brand ON public."Product" USING btree ("extractedBrand") WHERE ("extractedBrand" IS NOT NULL);


--
-- Name: idx_product_form; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_form ON public."Product" USING btree (form) WHERE (form IS NOT NULL);


--
-- Name: idx_product_form_aliases; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_form_aliases ON public."ProductForm" USING gin (aliases);


--
-- Name: idx_product_form_name; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_form_name ON public."ProductForm" USING btree (name);


--
-- Name: idx_product_form_normalized; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_form_normalized ON public."ProductForm" USING btree ("normalizedName");


--
-- Name: idx_product_group; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_group ON public."Product" USING btree ("productGroupId") WHERE ("productGroupId" IS NOT NULL);


--
-- Name: idx_product_group_category_fixed; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_group_category_fixed ON public."ProductGroup" USING btree ("categoryType");


--
-- Name: idx_product_group_core_identity; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_group_core_identity ON public."ProductGroup" USING btree ("coreProductIdentity") WHERE ("coreProductIdentity" IS NOT NULL);


--
-- Name: idx_product_group_ingredient_fixed; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_group_ingredient_fixed ON public."ProductGroup" USING btree ("coreIngredient");


--
-- Name: idx_product_group_key; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_group_key ON public."ProductGroup" USING btree ("groupKey");


--
-- Name: idx_product_group_normalized_trgm; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_group_normalized_trgm ON public."ProductGroup" USING gin ("normalizedName" public.gin_trgm_ops);


--
-- Name: idx_product_group_price; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_group_price ON public."Product" USING btree ("productGroupId", price) WHERE ("productGroupId" IS NOT NULL);


--
-- Name: idx_product_group_product_count; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_group_product_count ON public."ProductGroup" USING btree ("productCount" DESC);


--
-- Name: idx_product_grouping_key; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_grouping_key ON public."Product" USING btree ("groupingKey") WHERE ("groupingKey" IS NOT NULL);


--
-- Name: idx_product_keyword_tags; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_keyword_tags ON public."Product" USING gin ("keywordTags") WHERE ("keywordTags" IS NOT NULL);


--
-- Name: idx_product_normalized_lower; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_normalized_lower ON public."Product" USING btree (lower("normalizedName")) WHERE ("normalizedName" IS NOT NULL);


--
-- Name: idx_product_normalized_trgm; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_normalized_trgm ON public."Product" USING gin ("normalizedName" public.gin_trgm_ops) WHERE ("normalizedName" IS NOT NULL);


--
-- Name: idx_product_price; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_price ON public."Product" USING btree (price);


--
-- Name: idx_product_processed; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_processed ON public."Product" USING btree ("processedAt") WHERE ("processedAt" IS NOT NULL);


--
-- Name: idx_product_product_line; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_product_line ON public."Product" USING btree ("productLine") WHERE ("productLine" IS NOT NULL);


--
-- Name: idx_product_search_tokens; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_search_tokens ON public."Product" USING gin ("searchTokens") WHERE ("searchTokens" IS NOT NULL);


--
-- Name: idx_product_search_vector; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_search_vector ON public."Product" USING gin ("searchVector") WHERE ("searchVector" IS NOT NULL);


--
-- Name: idx_product_similarity_key; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_similarity_key ON public."Product" USING btree ("similarityKey") WHERE ("similarityKey" IS NOT NULL);


--
-- Name: idx_product_special_codes; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_special_codes ON public."Product" USING gin ("specialCodes") WHERE ("specialCodes" IS NOT NULL);


--
-- Name: idx_product_spf_value; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_spf_value ON public."Product" USING btree ("spfValue") WHERE ("spfValue" IS NOT NULL);


--
-- Name: idx_product_strength; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_strength ON public."Product" USING btree (strength) WHERE (strength IS NOT NULL);


--
-- Name: idx_product_title_lower; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_title_lower ON public."Product" USING btree (lower(title));


--
-- Name: idx_product_title_trgm; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_title_trgm ON public."Product" USING gin (title public.gin_trgm_ops);


--
-- Name: idx_product_unprocessed; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_unprocessed ON public."Product" USING btree (id) WHERE ("processedAt" IS NULL);


--
-- Name: idx_product_vendor; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_vendor ON public."Product" USING btree ("vendorId");


--
-- Name: idx_product_vendor_price; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_vendor_price ON public."Product" USING btree ("vendorId", price);


--
-- Name: idx_product_volume_value; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_product_volume_value ON public."Product" USING btree ("volumeValue") WHERE ("volumeValue" IS NOT NULL);


--
-- Name: idx_unit_name; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_unit_name ON public."Unit" USING btree (name);


--
-- Name: idx_vendor_name; Type: INDEX; Schema: public; Owner: ahab
--

CREATE INDEX idx_vendor_name ON public."Vendor" USING btree (name);


--
-- Name: Product product_group_stats_trigger; Type: TRIGGER; Schema: public; Owner: ahab
--

CREATE TRIGGER product_group_stats_trigger AFTER INSERT OR DELETE OR UPDATE ON public."Product" FOR EACH ROW EXECUTE FUNCTION public.update_group_stats_trigger();


--
-- Name: Brand update_brand_updated_at; Type: TRIGGER; Schema: public; Owner: ahab
--

CREATE TRIGGER update_brand_updated_at BEFORE UPDATE ON public."Brand" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: Category update_category_updated_at; Type: TRIGGER; Schema: public; Owner: ahab
--

CREATE TRIGGER update_category_updated_at BEFORE UPDATE ON public."Category" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: ProductForm update_product_form_updated_at; Type: TRIGGER; Schema: public; Owner: ahab
--

CREATE TRIGGER update_product_form_updated_at BEFORE UPDATE ON public."ProductForm" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: ProductGroup update_product_group_updated_at; Type: TRIGGER; Schema: public; Owner: ahab
--

CREATE TRIGGER update_product_group_updated_at BEFORE UPDATE ON public."ProductGroup" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: Product update_product_updated_at; Type: TRIGGER; Schema: public; Owner: ahab
--

CREATE TRIGGER update_product_updated_at BEFORE UPDATE ON public."Product" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: Unit update_unit_updated_at; Type: TRIGGER; Schema: public; Owner: ahab
--

CREATE TRIGGER update_unit_updated_at BEFORE UPDATE ON public."Unit" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: User update_user_updated_at; Type: TRIGGER; Schema: public; Owner: ahab
--

CREATE TRIGGER update_user_updated_at BEFORE UPDATE ON public."User" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: Vendor update_vendor_updated_at; Type: TRIGGER; Schema: public; Owner: ahab
--

CREATE TRIGGER update_vendor_updated_at BEFORE UPDATE ON public."Vendor" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: ProductGroup ProductGroup_brandId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."ProductGroup"
    ADD CONSTRAINT "ProductGroup_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES public."Brand"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ProductGroup ProductGroup_unitId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."ProductGroup"
    ADD CONSTRAINT "ProductGroup_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES public."Unit"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Product Product_brandId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."Product"
    ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES public."Brand"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Product Product_productGroupId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."Product"
    ADD CONSTRAINT "Product_productGroupId_fkey" FOREIGN KEY ("productGroupId") REFERENCES public."ProductGroup"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Product Product_unitId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."Product"
    ADD CONSTRAINT "Product_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES public."Unit"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Product Product_vendorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ahab
--

ALTER TABLE ONLY public."Product"
    ADD CONSTRAINT "Product_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

