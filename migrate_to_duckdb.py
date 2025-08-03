#!/usr/bin/env python3
"""
Migration script to move data from PostgreSQL to DuckDB
"""
import asyncio
import asyncpg
import duckdb
import os
import logging
from typing import List, Dict, Any

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def migrate_postgres_to_duckdb(
    postgres_url: str,
    duckdb_path: str = "pharma_search.db"
):
    """
    Migrate data from PostgreSQL to DuckDB
    """
    
    # Read the DuckDB schema
    schema_path = "/Users/ahab/pharma-search/duckdb_schema.sql"
    with open(schema_path, 'r') as f:
        duckdb_schema = f.read()
    
    # Connect to PostgreSQL
    logger.info("Connecting to PostgreSQL...")
    pg_conn = await asyncpg.connect(postgres_url)
    
    # Connect to DuckDB
    logger.info(f"Connecting to DuckDB at {duckdb_path}...")
    # Check if DuckDB file exists, if not create schema first
    if not os.path.exists(duckdb_path):
        logger.info(f"DuckDB file not found. Please run 'python create_duckdb_schema.py' first")
        return
    
    duck_conn = duckdb.connect(duckdb_path)
    
    try:
        # Verify schema exists
        logger.info("Verifying DuckDB schema...")
        try:
            tables = duck_conn.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'").fetchall()
            table_names = [t[0] for t in tables]
            logger.info(f"Found tables: {table_names}")
            
            if 'Product' not in table_names:
                logger.error("DuckDB schema not found. Please run 'python create_duckdb_schema.py' first")
                return
        except Exception as e:
            logger.error(f"Schema verification failed: {e}")
            return
        
        # List of tables to migrate (in dependency order)
        tables = [
            'Vendor',
            'Category', 
            'Brand',
            'Unit',
            'ProductName',
            'VendorLocations',
            'Product',
            'User'
        ]
        
        # Migrate each table
        for table in tables:
            await migrate_table(pg_conn, duck_conn, table)
        
        # Create full-text search index after data migration
        logger.info("Creating full-text search index...")
        try:
            duck_conn.execute("PRAGMA create_fts_index('products_fts', 'Product', 'title', 'normalizedName', 'description')")
            logger.info("Full-text search index created successfully")
        except Exception as e:
            logger.warning(f"FTS index creation failed: {e}")
        
        # Verify migration
        await verify_migration(pg_conn, duck_conn)
        
        logger.info("Migration completed successfully!")
        
    except Exception as e:
        logger.error(f"Migration failed: {e}")
        raise
    
    finally:
        await pg_conn.close()
        duck_conn.close()


async def migrate_table(pg_conn: asyncpg.Connection, duck_conn: duckdb.DuckDBPyConnection, table_name: str):
    """Migrate a single table from PostgreSQL to DuckDB"""
    
    logger.info(f"Migrating table: {table_name}")
    
    try:
        # Get data from PostgreSQL
        rows = await pg_conn.fetch(f'SELECT * FROM "{table_name}"')
        
        if not rows:
            logger.info(f"Table {table_name} is empty, skipping...")
            return
        
        logger.info(f"Found {len(rows)} rows in {table_name}")
        
        # Get column information
        pg_columns = list(rows[0].keys())
        
        # Get DuckDB columns for this table
        duck_columns_result = duck_conn.execute(f"DESCRIBE {table_name}").fetchall()
        duck_columns = [col[0] for col in duck_columns_result]
        
        # Filter columns to only include those that exist in both databases
        columns = [col for col in pg_columns if col in duck_columns]
        logger.info(f"Migrating columns: {columns}")
        
        # Handle special column mappings for DuckDB
        column_mapping = get_column_mapping(table_name)
        
        # Prepare data for DuckDB
        duck_data = []
        for row in rows:
            duck_row = []
            for col in columns:
                value = row.get(col)  # Use get() in case column doesn't exist
                
                # Handle special data type conversions
                if col in column_mapping:
                    value = column_mapping[col](value)
                elif isinstance(value, memoryview):
                    # Convert memoryview to bytes
                    value = bytes(value)
                elif col == 'searchTokens' and value:
                    # Convert PostgreSQL array to list for DuckDB
                    if isinstance(value, list):
                        value = value  # Already a list
                    elif isinstance(value, str):
                        # Parse PostgreSQL array string
                        value = parse_pg_array(value)
                    else:
                        value = []  # Default to empty list
                elif value is None:
                    value = None  # Keep NULL values
                
                duck_row.append(value)
            duck_data.append(duck_row)
        
        # Create insert statement
        placeholders = ', '.join(['?' for _ in columns])
        insert_sql = f"INSERT INTO {table_name} ({', '.join(columns)}) VALUES ({placeholders})"
        
        # Batch insert into DuckDB
        batch_size = 1000
        for i in range(0, len(duck_data), batch_size):
            batch = duck_data[i:i + batch_size]
            duck_conn.executemany(insert_sql, batch)
        
        logger.info(f"Successfully migrated {len(duck_data)} rows to {table_name}")
        
    except Exception as e:
        logger.error(f"Failed to migrate table {table_name}: {e}")
        raise


def get_column_mapping(table_name: str) -> Dict[str, callable]:
    """Get column mapping functions for data type conversion"""
    
    mappings = {}
    
    if table_name == 'Product':
        # Handle special columns in Product table
        mappings['searchVector'] = lambda x: None  # Remove tsvector data
        mappings['dosageValue'] = lambda x: float(x) if x is not None else None
    
    return mappings


def parse_pg_array(pg_array_str: str) -> List[str]:
    """Parse PostgreSQL array string to Python list"""
    if not pg_array_str or pg_array_str == '{}':
        return []
    
    # Remove braces and split by comma
    cleaned = pg_array_str.strip('{}')
    if not cleaned:
        return []
    
    # Simple parsing - may need to be more sophisticated for complex arrays
    items = [item.strip().strip('"') for item in cleaned.split(',')]
    return [item for item in items if item]


async def verify_migration(pg_conn: asyncpg.Connection, duck_conn: duckdb.DuckDBPyConnection):
    """Verify the migration was successful"""
    
    logger.info("Verifying migration...")
    
    tables = ['Vendor', 'Brand', 'Unit', 'ProductName', 'Product', 'User']
    
    for table in tables:
        # Get counts from both databases
        pg_count = await pg_conn.fetchval(f'SELECT COUNT(*) FROM "{table}"')
        duck_result = duck_conn.execute(f'SELECT COUNT(*) FROM {table}').fetchone()
        duck_count = duck_result[0] if duck_result else 0
        
        logger.info(f"{table}: PostgreSQL={pg_count}, DuckDB={duck_count}")
        
        if pg_count != duck_count:
            logger.warning(f"Row count mismatch in {table}!")
        else:
            logger.info(f"{table} migration verified ✓")


async def main():
    """Main migration function"""
    
    # Get PostgreSQL connection URL from environment or use default
    postgres_url = os.getenv(
        'DATABASE_URL', 
        'postgresql://postgres:docker@localhost:5432/pharmagician'
    )
    
    duckdb_path = "pharma_search.db"
    
    logger.info(f"Starting migration from PostgreSQL to DuckDB")
    logger.info(f"PostgreSQL URL: {postgres_url}")
    logger.info(f"DuckDB path: {duckdb_path}")
    
    await migrate_postgres_to_duckdb(postgres_url, duckdb_path)


if __name__ == "__main__":
    asyncio.run(main())