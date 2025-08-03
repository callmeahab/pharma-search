#!/usr/bin/env python3
"""
Create DuckDB schema only (separate from migration)
"""
import duckdb
import os
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def create_duckdb_schema(db_path: str = "pharma_search.db"):
    """Create DuckDB schema step by step"""
    
    # Remove existing database
    if os.path.exists(db_path):
        os.remove(db_path)
        logger.info(f"Removed existing database: {db_path}")
    
    # Connect to DuckDB
    conn = duckdb.connect(db_path)
    
    try:
        # Install FTS extension
        logger.info("Installing FTS extension...")
        try:
            conn.execute("INSTALL fts")
            conn.execute("LOAD fts")
            logger.info("✅ FTS extension installed")
        except Exception as e:
            logger.warning(f"FTS extension warning: {e}")
        
        # Create tables in dependency order
        logger.info("Creating tables...")
        
        # 1. Vendor table
        conn.execute("""
            CREATE TABLE Vendor (
                id VARCHAR PRIMARY KEY,
                name VARCHAR UNIQUE NOT NULL,
                logo VARCHAR,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                scraperFile VARCHAR,
                website VARCHAR
            )
        """)
        logger.info("✅ Created Vendor table")
        
        # 2. Category table
        conn.execute("""
            CREATE TABLE Category (
                id VARCHAR PRIMARY KEY,
                name VARCHAR UNIQUE NOT NULL,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        logger.info("✅ Created Category table")
        
        # 3. Brand table
        conn.execute("""
            CREATE TABLE Brand (
                id VARCHAR PRIMARY KEY,
                name VARCHAR UNIQUE NOT NULL,
                embedding BLOB,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        logger.info("✅ Created Brand table")
        
        # 4. Unit table
        conn.execute("""
            CREATE TABLE Unit (
                id VARCHAR PRIMARY KEY,
                name VARCHAR UNIQUE NOT NULL,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        logger.info("✅ Created Unit table")
        
        # 5. ProductName table
        conn.execute("""
            CREATE TABLE ProductName (
                id VARCHAR PRIMARY KEY,
                name VARCHAR UNIQUE NOT NULL,
                embedding BLOB,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        logger.info("✅ Created ProductName table")
        
        # 6. VendorLocations table (depends on Vendor)
        conn.execute("""
            CREATE TABLE VendorLocations (
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
            )
        """)
        logger.info("✅ Created VendorLocations table")
        
        # 7. Product table (depends on Vendor, Brand, Unit, ProductName)
        conn.execute("""
            CREATE TABLE Product (
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
            )
        """)
        logger.info("✅ Created Product table")
        
        # 8. User table
        conn.execute("""
            CREATE TABLE User (
                id VARCHAR PRIMARY KEY,
                name VARCHAR NOT NULL,
                email VARCHAR UNIQUE NOT NULL,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        logger.info("✅ Created User table")
        
        # Create indexes
        logger.info("Creating indexes...")
        
        indexes = [
            "CREATE INDEX idx_product_normalized_name ON Product(normalizedName)",
            "CREATE INDEX idx_product_vendor_id ON Product(vendorId)",
            "CREATE INDEX idx_product_brand_id ON Product(brandId)",
            "CREATE INDEX idx_product_price ON Product(price)",
            "CREATE INDEX idx_product_created_at ON Product(createdAt)",
            "CREATE INDEX idx_vendor_name ON Vendor(name)",
            "CREATE INDEX idx_brand_name ON Brand(name)",
        ]
        
        for index_sql in indexes:
            try:
                conn.execute(index_sql)
                logger.debug(f"✅ Created index: {index_sql}")
            except Exception as e:
                logger.warning(f"Index creation failed: {e}")
        
        logger.info("✅ All indexes created")
        
        # Create views
        logger.info("Creating views...")
        
        # ProductGroupStats view
        conn.execute("""
            CREATE VIEW ProductGroupStats AS
            SELECT 
                p.normalizedName,
                COUNT(*) as product_count,
                COUNT(DISTINCT p.vendorId) as vendor_count,
                MIN(p.price) as min_price,
                MAX(p.price) as max_price,
                AVG(p.price) as avg_price,
                LIST(DISTINCT p.vendorId) as vendor_ids,
                LIST(DISTINCT b.name) FILTER (WHERE b.name IS NOT NULL) as brands
            FROM Product p
            LEFT JOIN Brand b ON p.brandId = b.id
            WHERE p.normalizedName IS NOT NULL
            GROUP BY p.normalizedName
            HAVING COUNT(*) > 1
        """)
        logger.info("✅ Created ProductGroupStats view")
        
        # PriceComparisonView
        conn.execute("""
            CREATE VIEW PriceComparisonView AS
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
                p.updatedAt
            FROM Product p
            JOIN Vendor v ON p.vendorId = v.id
            LEFT JOIN Brand b ON p.brandId = b.id
            WHERE p.normalizedName IS NOT NULL
            ORDER BY p.normalizedName, p.price
        """)
        logger.info("✅ Created PriceComparisonView")
        
        # Verify tables were created
        tables = conn.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'").fetchall()
        table_names = [t[0] for t in tables]
        
        expected_tables = ['Vendor', 'Category', 'Brand', 'Unit', 'ProductName', 'VendorLocations', 'Product', 'User']
        
        logger.info("Verifying tables...")
        for table in expected_tables:
            if table in table_names:
                logger.info(f"✅ {table} table exists")
            else:
                logger.error(f"❌ {table} table missing")
        
        logger.info("🎉 DuckDB schema created successfully!")
        
    except Exception as e:
        logger.error(f"Schema creation failed: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    create_duckdb_schema()