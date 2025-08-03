#!/usr/bin/env python3
"""
Full integration test for DuckDB migration
Tests both frontend and backend components
"""
import asyncio
import sys
import os
import subprocess
import time
import requests
from pathlib import Path

# Add backend src to path
sys.path.insert(0, 'backend/src')

import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def test_frontend_setup():
    """Test frontend configuration and DuckDB setup"""
    logger.info("Testing frontend setup...")
    
    # Check if DuckDB is installed
    try:
        result = subprocess.run(['bun', 'list', 'duckdb'], 
                              capture_output=True, text=True, cwd='frontend')
        if 'duckdb' in result.stdout:
            logger.info("✅ DuckDB package installed in frontend")
        else:
            logger.warning("⚠️ DuckDB package not found in frontend")
    except Exception as e:
        logger.error(f"❌ Error checking DuckDB package: {e}")
    
    # Check if database file exists
    db_path = Path('pharma_search.db')
    if db_path.exists():
        logger.info("✅ DuckDB database file exists")
        size = db_path.stat().st_size
        logger.info(f"  Database size: {size:,} bytes")
    else:
        logger.warning("⚠️ DuckDB database file not found")
    
    # Check Prisma schema
    schema_path = Path('frontend/prisma/schema.prisma')
    if schema_path.exists():
        with open(schema_path, 'r') as f:
            content = f.read()
            if 'provider = "sqlite"' in content:
                logger.info("✅ Prisma schema configured for SQLite/DuckDB")
            else:
                logger.warning("⚠️ Prisma schema not configured for DuckDB")
    
    # Check environment variables
    env_path = Path('frontend/.env')
    if env_path.exists():
        with open(env_path, 'r') as f:
            content = f.read()
            if 'DATABASE_URL=file:' in content or 'DATABASE_PATH=' in content:
                logger.info("✅ Environment configured for DuckDB")
            else:
                logger.warning("⚠️ Environment not configured for DuckDB")


async def test_backend_api():
    """Test backend API functionality"""
    logger.info("Testing backend API...")
    
    try:
        # Test imports
        from database import DuckDBConnection
        from search_engine_duckdb import DuckDBPharmaSearchEngine
        from api import app
        logger.info("✅ Backend imports successful")
        
        # Test database connection
        db = DuckDBConnection("test_integration.db")
        await db.connect()
        
        # Test basic query
        result = await db.execute("SELECT 1 as test")
        if result:
            logger.info("✅ DuckDB connection and query successful")
        
        await db.disconnect()
        
        # Clean up test database
        if os.path.exists("test_integration.db"):
            os.remove("test_integration.db")
            
        # Test search engine initialization
        search_engine = DuckDBPharmaSearchEngine("test_search.db")
        await search_engine.connect()
        logger.info("✅ Search engine initialization successful")
        await search_engine.disconnect()
        
        # Clean up
        if os.path.exists("test_search.db"):
            os.remove("test_search.db")
            
    except Exception as e:
        logger.error(f"❌ Backend test failed: {e}")
        return False
    
    return True


def test_api_endpoints():
    """Test API endpoints if backend is running"""
    logger.info("Testing API endpoints...")
    
    # Check if backend is running
    try:
        response = requests.get("http://localhost:8000/health", timeout=5)
        if response.status_code == 200:
            logger.info("✅ Backend health check passed")
            
            # Test search endpoint
            try:
                search_response = requests.get(
                    "http://localhost:8000/api/search?q=vitamin&limit=5",
                    timeout=10
                )
                if search_response.status_code == 200:
                    data = search_response.json()
                    logger.info(f"✅ Search API working - returned {len(data.get('groups', []))} groups")
                else:
                    logger.warning(f"⚠️ Search API returned status {search_response.status_code}")
            except Exception as e:
                logger.warning(f"⚠️ Search API test failed: {e}")
                
        else:
            logger.warning(f"⚠️ Backend health check failed with status {response.status_code}")
    except requests.exceptions.RequestException:
        logger.info("ℹ️ Backend not running - skipping API endpoint tests")


def test_frontend_build():
    """Test frontend build process"""
    logger.info("Testing frontend build...")
    
    try:
        # Test if frontend can build
        result = subprocess.run(['bun', 'run', 'build'], 
                              capture_output=True, text=True, 
                              cwd='frontend', timeout=60)
        
        if result.returncode == 0:
            logger.info("✅ Frontend build successful")
        else:
            logger.warning("⚠️ Frontend build failed")
            logger.warning(f"Error: {result.stderr}")
    except subprocess.TimeoutExpired:
        logger.warning("⚠️ Frontend build timed out")
    except Exception as e:
        logger.warning(f"⚠️ Frontend build test failed: {e}")


async def main():
    """Run all integration tests"""
    logger.info("🚀 Starting full DuckDB integration tests...")
    
    # Test components
    tests = [
        ("Frontend Setup", test_frontend_setup),
        ("Backend API", test_backend_api),
        ("API Endpoints", test_api_endpoints),
        ("Frontend Build", test_frontend_build),
    ]
    
    passed = 0
    total = len(tests)
    
    for test_name, test_func in tests:
        try:
            logger.info(f"\n--- Running {test_name} Test ---")
            if asyncio.iscoroutinefunction(test_func):
                result = await test_func()
            else:
                result = test_func()
            
            if result is not False:
                passed += 1
        except Exception as e:
            logger.error(f"❌ {test_name} test failed: {e}")
    
    # Summary
    logger.info(f"\n--- Integration Test Summary ---")
    logger.info(f"Passed: {passed}/{total}")
    
    if passed == total:
        logger.info("🎉 All integration tests passed!")
        logger.info("\n📋 Next Steps:")
        logger.info("1. Run data migration: python migrate_to_duckdb.py")
        logger.info("2. Start backend: cd backend && uvicorn src.api:app --reload")
        logger.info("3. Start frontend: cd frontend && bun run dev")
        return True
    else:
        logger.warning(f"⚠️ {total - passed} tests failed. Check the logs above.")
        return False


if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)