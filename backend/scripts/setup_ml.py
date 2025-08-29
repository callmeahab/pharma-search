#!/usr/bin/env python3
"""
Setup script for ML-enhanced preprocessing
Installs dependencies and initializes ML models with CUDA/Metal support
"""

import asyncio
import logging
import os
import sys
import subprocess
import torch
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Add the parent directory to the path so we can import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def check_gpu_availability():
    """Check available GPU acceleration"""
    
    logger.info("Checking GPU acceleration availability...")
    
    # Check CUDA
    if torch.cuda.is_available():
        device_count = torch.cuda.device_count()
        device_name = torch.cuda.get_device_name(0)
        logger.info(f"✓ CUDA available: {device_count} device(s)")
        logger.info(f"  Primary device: {device_name}")
        return "cuda"
    
    # Check Metal (Apple Silicon)
    elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
        logger.info("✓ Metal Performance Shaders (MPS) available")
        return "mps"
    
    else:
        logger.info("ℹ Using CPU - no GPU acceleration available")
        return "cpu"


def install_ml_dependencies():
    """Install ML dependencies optimized for the detected hardware"""
    
    logger.info("Installing ML dependencies...")
    
    # Install essential dependencies first
    essential_deps = ["asyncpg", "python-dotenv"]
    
    for dep in essential_deps:
        try:
            logger.info(f"Installing {dep}...")
            subprocess.run([sys.executable, "-m", "pip", "install", dep], check=True)
        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to install {dep}: {e}")
            raise
    
    device = check_gpu_availability()
    
    if device == "cuda":
        logger.info("Installing CUDA-optimized PyTorch...")
        # Install CUDA version of PyTorch
        subprocess.run([
            sys.executable, "-m", "pip", "install", 
            "torch", "torchvision", "torchaudio", 
            "--index-url", "https://download.pytorch.org/whl/cu118"
        ], check=True)
    
    elif device == "mps":
        logger.info("Installing Metal-optimized PyTorch...")
        # macOS with Metal support
        subprocess.run([
            sys.executable, "-m", "pip", "install", 
            "torch", "torchvision", "torchaudio"
        ], check=True)
    
    else:
        logger.info("Installing CPU-only PyTorch...")
        subprocess.run([
            sys.executable, "-m", "pip", "install", 
            "torch", "torchvision", "torchaudio", "--index-url", 
            "https://download.pytorch.org/whl/cpu"
        ], check=True)
    
    # Install other ML dependencies
    ml_deps = ["transformers", "scikit-learn", "sentence-transformers"]
    for dep in ml_deps:
        try:
            logger.info(f"Installing {dep}...")
            subprocess.run([sys.executable, "-m", "pip", "install", dep], check=True)
        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to install {dep}: {e}")
            raise
    
    logger.info("✓ All ML dependencies installed successfully")


def verify_installation():
    """Verify that all ML components are working"""
    
    logger.info("Verifying ML installation...")
    
    try:
        import torch
        import transformers
        from sklearn.cluster import DBSCAN
        from sentence_transformers import SentenceTransformer
        
        logger.info(f"✓ PyTorch version: {torch.__version__}")
        logger.info(f"✓ Transformers version: {transformers.__version__}")
        
        # Test device
        device = torch.device("cuda" if torch.cuda.is_available() 
                            else "mps" if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available()
                            else "cpu")
        
        logger.info(f"✓ Using device: {device}")
        
        # Test basic tensor operations
        x = torch.randn(5, 5).to(device)
        y = torch.matmul(x, x)
        logger.info(f"✓ Basic tensor operations working on {device}")
        
        # Test transformer model loading
        logger.info("Testing transformer model loading...")
        from transformers import AutoTokenizer, AutoModel
        tokenizer = AutoTokenizer.from_pretrained("sentence-transformers/all-MiniLM-L6-v2")
        model = AutoModel.from_pretrained("sentence-transformers/all-MiniLM-L6-v2")
        logger.info("✓ Transformer models loaded successfully")
        
        return True
        
    except Exception as e:
        logger.error(f"✗ Installation verification failed: {e}")
        return False


async def initialize_ml_models():
    """Initialize ML models for pharmaceutical preprocessing"""
    
    logger.info("Initializing ML models for pharmaceutical preprocessing...")
    
    try:
        from src.ml_preprocessor import initialize_ml_preprocessor
        
        # Check if DATABASE_URL is set
        db_url = os.getenv('DATABASE_URL')
        if not db_url:
            logger.error("DATABASE_URL environment variable not set")
            logger.info("Please set DATABASE_URL before initializing ML models")
            return False
        
        # Initialize ML preprocessor
        ml_preprocessor = await initialize_ml_preprocessor(force_retrain=True)
        
        if ml_preprocessor:
            logger.info("✓ ML preprocessor initialized successfully")
            
            # Test the preprocessor
            test_similarity = ml_preprocessor.compute_similarity("test1", "test2")
            logger.info(f"✓ ML similarity computation working (test result: {test_similarity})")
            
            return True
        else:
            logger.error("✗ Failed to initialize ML preprocessor")
            return False
            
    except Exception as e:
        logger.error(f"✗ ML model initialization failed: {e}")
        return False


async def run_preprocessing_benchmark():
    """Run a performance benchmark of the ML preprocessing"""
    
    logger.info("Running ML preprocessing benchmark...")
    
    try:
        from src.ml_preprocessor import get_ml_preprocessor
        import time
        
        ml_preprocessor = get_ml_preprocessor()
        if not ml_preprocessor:
            logger.warning("ML preprocessor not initialized, skipping benchmark")
            return
        
        # Benchmark similarity computation
        if len(ml_preprocessor.product_embeddings) >= 2:
            product_ids = list(ml_preprocessor.product_embeddings.keys())[:100]  # Test with first 100
            
            start_time = time.time()
            similarity_count = 0
            
            for i in range(min(10, len(product_ids))):
                for j in range(i+1, min(10, len(product_ids))):
                    similarity = ml_preprocessor.compute_similarity(product_ids[i], product_ids[j])
                    similarity_count += 1
            
            elapsed_time = time.time() - start_time
            
            logger.info(f"✓ Computed {similarity_count} similarities in {elapsed_time:.2f}s")
            logger.info(f"  Average: {(elapsed_time/similarity_count)*1000:.2f}ms per similarity")
            
            # Test clustering
            start_time = time.time()
            clusters = ml_preprocessor.get_ml_clusters(product_ids[:20])
            elapsed_time = time.time() - start_time
            
            logger.info(f"✓ ML clustering of 20 products: {elapsed_time:.2f}s")
            logger.info(f"  Found {len(clusters)} clusters")
        
    except Exception as e:
        logger.error(f"✗ Benchmark failed: {e}")


async def main():
    """Main setup function"""
    
    logger.info("=== ML-Enhanced Preprocessing Setup ===")
    
    # Step 1: Check hardware and install dependencies
    logger.info("\n1. Installing ML dependencies...")
    install_ml_dependencies()
    
    # Step 2: Verify installation
    logger.info("\n2. Verifying installation...")
    if not verify_installation():
        logger.error("Installation verification failed. Please check the errors above.")
        return
    
    # Step 3: Initialize ML models
    logger.info("\n3. Initializing ML models...")
    success = await initialize_ml_models()
    
    if not success:
        logger.error("ML model initialization failed.")
        logger.info("Make sure you have:")
        logger.info("- Set DATABASE_URL environment variable")
        logger.info("- Run preprocessing script first: python scripts/preprocess_products.py")
        return
    
    # Step 4: Run benchmark
    logger.info("\n4. Running performance benchmark...")
    await run_preprocessing_benchmark()
    
    logger.info("\n=== Setup Complete ===")
    logger.info("ML-enhanced preprocessing is ready!")
    logger.info("\nNext steps:")
    logger.info("1. Restart your backend server")
    logger.info("2. ML-enhanced grouping will be used automatically")
    logger.info("3. Check logs for 'ML clustering found X clusters' messages")


if __name__ == "__main__":
    asyncio.run(main())