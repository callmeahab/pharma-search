
-- DuckDB Schema for Pharma Search Application

-- Enable FTS extension
INSTALL fts;
LOAD fts;

-- Vendor table
CREATE TABLE IF NOT EXISTS Vendor (
    id VARCHAR PRIMARY KEY,
    name VARCHAR UNIQUE NOT NULL,
    logo VARCHAR,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    scraperFile VARCHAR,
    website VARCHAR
);

-- Category table
CREATE TABLE IF NOT EXISTS Category (
    id VARCHAR PRIMARY KEY,
    name VARCHAR UNIQUE NOT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- VendorLocations table
CREATE TABLE IF NOT EXISTS VendorLocations (
    id VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL,
    address VARCHAR NOT NULL,
    city VARCHAR NOT NULL,
    country VARCHAR NOT NULL,
    phone VARCHAR NOT NULL,
    email VARCHAR NOT NULL,
    latitude DOUBLE NOT NULL,
    longitude DOUBLE NOT NULL,
    vendorId VARCHAR NOT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vendorId) REFERENCES Vendor(id)
);

-- Brand table
CREATE TABLE IF NOT EXISTS Brand (
    id VARCHAR PRIMARY KEY,
    name VARCHAR UNIQUE NOT NULL,
    embedding BLOB,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unit table
CREATE TABLE IF NOT EXISTS Unit (
    id VARCHAR PRIMARY KEY,
    name VARCHAR UNIQUE NOT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ProductName table
CREATE TABLE IF NOT EXISTS ProductName (
    id VARCHAR PRIMARY KEY,
    name VARCHAR UNIQUE NOT NULL,
    embedding BLOB,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Product table
CREATE TABLE IF NOT EXISTS Product (
    id VARCHAR PRIMARY KEY,
    vendorId VARCHAR NOT NULL,
    price DOUBLE NOT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    title VARCHAR NOT NULL,
    category VARCHAR,
    link VARCHAR NOT NULL,
    thumbnail VARCHAR NOT NULL,
    photos VARCHAR NOT NULL,
    brandConfidence DOUBLE,
    brandId VARCHAR,
    description VARCHAR,
    dosageUnit VARCHAR,
    dosageValue DECIMAL(10,3),
    normalizedName VARCHAR,
    originalTitle VARCHAR,
    processedAt TIMESTAMP,
    productNameConfidence DOUBLE,
    productNameId VARCHAR,
    quantity INTEGER,
    quantityConfidence DOUBLE,
    searchTokens VARCHAR[],
    titleEmbedding BLOB,
    unitConfidence DOUBLE,
    unitId VARCHAR,
    FOREIGN KEY (brandId) REFERENCES Brand(id),
    FOREIGN KEY (productNameId) REFERENCES ProductName(id),
    FOREIGN KEY (unitId) REFERENCES Unit(id),
    FOREIGN KEY (vendorId) REFERENCES Vendor(id),
    UNIQUE (title, vendorId)
);

-- User table
CREATE TABLE IF NOT EXISTS User (
    id VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL,
    email VARCHAR UNIQUE NOT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_product_normalized_name ON Product(normalizedName);
CREATE INDEX IF NOT EXISTS idx_product_vendor_id ON Product(vendorId);
CREATE INDEX IF NOT EXISTS idx_product_brand_id ON Product(brandId);
CREATE INDEX IF NOT EXISTS idx_product_price ON Product(price);
CREATE INDEX IF NOT EXISTS idx_product_created_at ON Product(createdAt);

-- Note: FTS index will be created after data insertion

-- Create materialized views for analytics (DuckDB style)
CREATE VIEW IF NOT EXISTS ProductGroupStats AS
SELECT 
    p.normalizedName,
    COUNT(*) as product_count,
    COUNT(DISTINCT p.vendorId) as vendor_count,
    MIN(p.price) as min_price,
    MAX(p.price) as max_price,
    AVG(p.price) as avg_price,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY p.price) as median_price,
    LIST(DISTINCT p.vendorId) as vendor_ids,
    LIST(DISTINCT b.name) FILTER (WHERE b.name IS NOT NULL) as brands
FROM Product p
LEFT JOIN Brand b ON p.brandId = b.id
WHERE p.normalizedName IS NOT NULL
GROUP BY p.normalizedName
HAVING COUNT(*) > 1;

-- Price comparison view
CREATE VIEW IF NOT EXISTS PriceComparisonView AS
SELECT 
    p.id,
    p.title,
    p.price,
    p.normalizedName,
    p.link,
    p.thumbnail,
    v.name as vendor_name,
    v.website as vendor_website,
    b.name as brand_name,
    p.createdAt,
    p.updatedAt,
    -- Price statistics
    stats.min_price,
    stats.max_price,
    stats.avg_price,
    stats.vendor_count,
    stats.product_count,
    -- Price analysis
    p.price - stats.avg_price as price_diff_from_avg,
    CASE 
        WHEN stats.max_price - stats.min_price > 0 
        THEN ((p.price - stats.min_price) / (stats.max_price - stats.min_price)) * 100 
        ELSE 0 
    END as price_percentile
FROM Product p
JOIN Vendor v ON p.vendorId = v.id
LEFT JOIN Brand b ON p.brandId = b.id
JOIN ProductGroupStats stats ON p.normalizedName = stats.normalizedName
WHERE stats.product_count > 1
ORDER BY stats.product_count DESC, p.price;
