#!/usr/bin/env python3
"""
Simple migration helper for Docker containers
"""
import asyncio
import os
import logging
from typing import Optional
from database import DuckDBConnection

logger = logging.getLogger(__name__)

async def ensure_database_ready(db_path: str) -> bool:
    """
    Ensure database is ready with schema and data
    Returns True if database is ready, False if it needs migration
    """
    try:
        db = DuckDBConnection(db_path)
        await db.connect()
        
        # Check if tables exist
        tables = await db.execute("SHOW TABLES")
        table_names = [t['table_name'] for t in tables] if tables else []
        
        if 'Product' not in table_names:
            logger.info("Product table not found. Need to initialize schema.")
            await db.disconnect()
            return False
        
        # Check if we have data
        result = await db.execute("SELECT COUNT(*) as count FROM Product")
        product_count = result[0]['count'] if result else 0
        
        await db.disconnect()
        
        if product_count == 0:
            logger.info("Product table is empty. Need to migrate data.")
            return False
        
        logger.info(f"Database ready with {product_count} products")
        return True
        
    except Exception as e:
        logger.error(f"Error checking database: {e}")
        return False

async def create_schema_only(db_path: str) -> bool:
    """Create database schema without data"""
    try:
        # Look for schema file
        schema_paths = [
            '/app/duckdb_schema.sql',
            'duckdb_schema.sql',
            '../duckdb_schema.sql'
        ]
        
        schema_path = None
        for path in schema_paths:
            if os.path.exists(path):
                schema_path = path
                break
        
        if not schema_path:
            logger.error("Schema file not found")
            return False
        
        logger.info(f"Creating schema from {schema_path}")
        
        db = DuckDBConnection(db_path)
        await db.connect()
        
        with open(schema_path, 'r') as f:
            schema_sql = f.read()
        
        # Split and execute statements
        statements = schema_sql.split(';')
        for statement in statements:
            statement = statement.strip()
            if statement and not statement.startswith('--'):
                try:
                    await db.execute(statement)
                except Exception as e:
                    if 'already exists' not in str(e).lower():
                        logger.warning(f"Schema statement failed: {e}")
        
        await db.disconnect()
        logger.info("Schema created successfully")
        return True
        
    except Exception as e:
        logger.error(f"Failed to create schema: {e}")
        return False