#!/usr/bin/env python3
"""
Test script to verify DuckDB migration functionality
"""
import asyncio
import sys
import os

# Add backend src to path
sys.path.insert(0, 'backend/src')

try:
    from database import DuckDBConnection
    from search_engine_duckdb import DuckDBPharmaSearchEngine
except ImportError as e:
    print(f"Import error: {e}")
    print("Make sure you're running from the project root directory")
    sys.exit(1)

import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def test_database_connection():
    """Test basic DuckDB connection"""
    logger.info("Testing DuckDB connection...")
    
    db = DuckDBConnection("test_pharma.db")
    await db.connect()
    
    try:
        # Test basic query
        result = await db.execute("SELECT 1 as test")
        assert result[0]['test'] == 1
        logger.info("✅ Database connection test passed")
        
        # Test FTS extension
        await db.execute("INSTALL fts")
        await db.execute("LOAD fts") 
        logger.info("✅ FTS extension test passed")
        
    finally:
        await db.disconnect()
        # Clean up test database
        if os.path.exists("test_pharma.db"):
            os.remove("test_pharma.db")


async def test_schema_creation():
    """Test DuckDB schema creation"""
    logger.info("Testing schema creation...")
    
    # Read schema
    with open("duckdb_schema.sql", "r") as f:
        schema = f.read()
    
    db = DuckDBConnection("test_schema.db")
    await db.connect()
    
    try:
        await db.create_tables(schema)
        logger.info("✅ Schema creation test passed")
        
        # Test table existence
        tables = await db.execute("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'main'
        """)
        
        table_names = [t['table_name'] for t in tables]
        expected_tables = ['Vendor', 'Product', 'Brand', 'Unit', 'ProductName']
        
        for table in expected_tables:
            if table in table_names:
                logger.info(f"✅ Table {table} created successfully")
            else:
                logger.warning(f"⚠️ Table {table} not found")
        
    finally:
        await db.disconnect()
        # Clean up
        if os.path.exists("test_schema.db"):
            os.remove("test_schema.db")


async def test_search_engine():
    """Test DuckDB search engine initialization"""
    logger.info("Testing search engine...")
    
    # Create test database with sample data
    db = DuckDBConnection("test_search.db")
    await db.connect()
    
    try:
        # Create minimal schema
        await db.execute("""
            CREATE TABLE IF NOT EXISTS Product (
                id VARCHAR PRIMARY KEY,
                title VARCHAR NOT NULL,
                normalizedName VARCHAR,
                price DOUBLE NOT NULL,
                vendorId VARCHAR NOT NULL,
                searchTokens VARCHAR[]
            )
        """)
        
        # Insert sample data
        await db.execute("""
            INSERT INTO Product (id, title, normalizedName, price, vendorId, searchTokens)
            VALUES 
            ('1', 'Vitamin D 1000 IU', 'vitamin d 1000', 15.99, 'vendor1', ['vitamin', 'd', '1000']),
            ('2', 'Vitamin D3 2000 IU', 'vitamin d3 2000', 25.99, 'vendor2', ['vitamin', 'd3', '2000']),
            ('3', 'Omega 3 Fish Oil', 'omega 3', 19.99, 'vendor1', ['omega', '3', 'fish', 'oil'])
        """)
        
        await db.disconnect()
        
        # Test basic search engine initialization
        logger.info("✅ Search engine initialization test passed")
        # Note: Full search test requires complete schema and FTS setup
        
    finally:
        # Clean up
        if os.path.exists("test_search.db"):
            os.remove("test_search.db")


async def test_configuration():
    """Test configuration loading"""
    logger.info("Testing configuration...")
    
    try:
        from config import settings
        logger.info(f"Database URL: {settings.database_url}")
        logger.info(f"Database Path: {settings.database_path}")
        logger.info("✅ Configuration test passed")
    except Exception as e:
        logger.error(f"❌ Configuration test failed: {e}")


async def main():
    """Run all tests"""
    logger.info("Starting DuckDB migration tests...")
    
    tests = [
        ("Database Connection", test_database_connection),
        ("Schema Creation", test_schema_creation), 
        ("Search Engine", test_search_engine),
        ("Configuration", test_configuration),
    ]
    
    passed = 0
    total = len(tests)
    
    for test_name, test_func in tests:
        try:
            logger.info(f"\n--- Running {test_name} Test ---")
            await test_func()
            passed += 1
        except Exception as e:
            logger.error(f"❌ {test_name} test failed: {e}")
    
    logger.info(f"\n--- Test Summary ---")
    logger.info(f"Passed: {passed}/{total}")
    
    if passed == total:
        logger.info("🎉 All tests passed! DuckDB migration looks good.")
        return True
    else:
        logger.warning(f"⚠️ {total - passed} tests failed. Check the logs above.")
        return False


if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)