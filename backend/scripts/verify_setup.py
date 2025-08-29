#!/usr/bin/env python3
"""
Simple verification script for backend dependencies
Checks that all required packages are installed and working
"""

import sys
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def verify_core_dependencies():
    """Verify core FastAPI dependencies"""
    try:
        import fastapi
        import uvicorn
        import pydantic
        import asyncpg
        logger.info(f"✓ FastAPI: {fastapi.__version__}")
        logger.info(f"✓ Uvicorn: {uvicorn.__version__}")
        logger.info(f"✓ Pydantic: {pydantic.__version__}")
        logger.info(f"✓ AsyncPG: {asyncpg.__version__}")
        return True
    except ImportError as e:
        logger.error(f"✗ Missing core dependency: {e}")
        return False

def verify_text_processing():
    """Verify text processing dependencies"""
    try:
        import rapidfuzz
        from transliterate import translit
        from unidecode import unidecode
        logger.info(f"✓ RapidFuzz: {rapidfuzz.__version__}")
        logger.info("✓ Transliterate and Unidecode working")
        
        # Test functionality
        test_text = "test"
        score = rapidfuzz.fuzz.ratio(test_text, test_text)
        cleaned = unidecode("café")
        logger.info(f"✓ Text processing functional (test score: {score})")
        return True
    except ImportError as e:
        logger.error(f"✗ Missing text processing dependency: {e}")
        return False

def verify_ml_dependencies():
    """Verify ML dependencies (optional)"""
    try:
        import numpy
        from sklearn.cluster import DBSCAN
        from sentence_transformers import SentenceTransformer
        logger.info(f"✓ NumPy: {numpy.__version__}")
        logger.info("✓ Scikit-learn and Sentence Transformers available")
        
        # Test basic functionality
        arr = numpy.array([1, 2, 3])
        logger.info(f"✓ ML dependencies functional")
        return True
    except ImportError as e:
        logger.warning(f"⚠ ML dependencies not available: {e}")
        logger.info("  ML features will be disabled - this is OK for basic operation")
        return False

def verify_database_connection():
    """Verify database connection can be established"""
    import os
    import asyncio
    
    async def test_connection():
        try:
            db_url = os.getenv('DATABASE_URL')
            if not db_url:
                logger.warning("⚠ DATABASE_URL not set - cannot test database connection")
                return False
            
            import asyncpg
            conn = await asyncpg.connect(db_url)
            await conn.execute('SELECT 1')
            await conn.close()
            logger.info("✓ Database connection successful")
            return True
        except Exception as e:
            logger.warning(f"⚠ Database connection failed: {e}")
            logger.info("  Check your DATABASE_URL and PostgreSQL server")
            return False
    
    return asyncio.run(test_connection())

def main():
    """Main verification function"""
    logger.info("=== Backend Dependency Verification ===")
    
    success = True
    
    logger.info("\n1. Core Dependencies:")
    if not verify_core_dependencies():
        success = False
    
    logger.info("\n2. Text Processing:")
    if not verify_text_processing():
        success = False
    
    logger.info("\n3. ML Dependencies (optional):")
    verify_ml_dependencies()  # Don't fail on ML deps
    
    logger.info("\n4. Database Connection:")
    verify_database_connection()  # Don't fail on DB connection
    
    if success:
        logger.info("\n✅ All required dependencies are working!")
        logger.info("The backend should start successfully.")
    else:
        logger.error("\n❌ Some required dependencies are missing.")
        logger.info("Run: pip install -r requirements.txt")
        sys.exit(1)

if __name__ == "__main__":
    main()