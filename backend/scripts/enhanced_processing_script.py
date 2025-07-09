#!/usr/bin/env python3
"""
Enhanced Product Processing Script
Reprocesses all products with improved grouping for better price comparison
"""

import asyncio
import logging
import sys
from pathlib import Path
import argparse
from datetime import datetime

# Add the parent directory to the path so we can import our modules
sys.path.append(str(Path(__file__).parent.parent))

from src.product_processor import EnhancedProductProcessor
from src.config import settings

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(f"enhanced_processing_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log")
    ]
)

logger = logging.getLogger(__name__)


async def run_enhanced_processing(reprocess_all: bool = False, analyze_only: bool = False):
    """Run the enhanced product processing"""
    
    logger.info("🚀 Starting Enhanced Product Processing for Better Price Comparison")
    logger.info("=" * 70)
    
    processor = EnhancedProductProcessor(settings.database_url)
    
    try:
        await processor.connect()
        
        if analyze_only:
            logger.info("📊 Running grouping analysis only...")
            await processor.analyze_grouping_effectiveness()
            return
        
        if reprocess_all:
            logger.info("🔄 Reprocessing ALL products with new grouping logic...")
            await processor.reprocess_all_products()
        else:
            logger.info("⚡ Processing unprocessed products with enhanced grouping...")
            await processor.process_products(batch_size=settings.batch_size)
        
        # Analyze results
        logger.info("📊 Analyzing grouping effectiveness...")
        await processor.analyze_grouping_effectiveness()
        
        logger.info("✅ Enhanced processing completed successfully!")
        
    except Exception as e:
        logger.error(f"❌ Processing failed: {e}")
        raise
    finally:
        await processor.disconnect()


async def test_grouping_improvements():
    """Test specific grouping improvements"""
    
    logger.info("🧪 Testing Grouping Improvements")
    logger.info("=" * 50)
    
    # Test cases that should now be grouped better
    test_cases = [
        # These should be grouped together for price comparison
        ("Vitamin D3 1000 IU", "Vitamin D 1000 IU", "Should group different D3 variants"),
        ("Whey Protein 30g", "Protein Powder 30g", "Should group different protein types"),
        ("Omega-3 Fish Oil", "Omega 3 EPA DHA", "Should group omega-3 variants"),
        ("Calcium 500mg", "Calcium Citrate 500mg", "Should group calcium forms"),
        ("Magnesium 200mg", "Magnesium Oxide 200mg", "Should group magnesium forms"),
        ("Vitamin C 1000mg", "Ascorbic Acid 1000mg", "Should group vitamin C forms"),
        ("CoQ10 100mg", "Coenzyme Q10 100mg", "Should group CoQ10 variants"),
        ("B-Complex", "Vitamin B Complex", "Should group B-complex variants"),
    ]
    
    from src.normalizer import PharmaNormalizer
    normalizer = PharmaNormalizer()
    
    logger.info("Testing product grouping logic:")
    
    for title1, title2, description in test_cases:
        processed1 = normalizer.normalize(title1)
        processed2 = normalizer.normalize(title2)
        
        # Check if they have the same group key or similarity key
        same_group = processed1.group_key == processed2.group_key
        same_similarity = getattr(processed1, 'similarity_key', None) == getattr(processed2, 'similarity_key', None)
        
        status = "✅ GROUPED" if same_group or same_similarity else "❌ SEPARATE"
        
        logger.info(f"  {status}: {title1} | {title2}")
        logger.info(f"    {description}")
        logger.info(f"    Group1: {processed1.group_key}")
        logger.info(f"    Group2: {processed2.group_key}")
        
        if hasattr(processed1, 'similarity_key'):
            logger.info(f"    Sim1: {processed1.similarity_key}")
            logger.info(f"    Sim2: {processed2.similarity_key}")
        
        logger.info("")


async def compare_old_vs_new_grouping():
    """Compare the old vs new grouping effectiveness"""
    
    logger.info("📈 Comparing Old vs New Grouping")
    logger.info("=" * 50)
    
    # This would require database queries to compare before/after
    # For now, we'll just analyze the current state
    
    processor = EnhancedProductProcessor(settings.database_url)
    
    try:
        await processor.connect()
        await processor.analyze_grouping_effectiveness()
        
        logger.info("\n💡 Key Improvements Expected:")
        logger.info("  • More products per group (better aggregation)")
        logger.info("  • More vendors per group (better price comparison)")
        logger.info("  • Similar products from different brands grouped together")
        logger.info("  • Flexible dosage grouping (e.g., 500mg-1000mg in same group)")
        logger.info("  • Core product identity matching (e.g., 'Vitamin D3' = 'Vitamin D')")
        
    finally:
        await processor.disconnect()


async def main():
    """Main function with command line argument parsing"""
    
    parser = argparse.ArgumentParser(description="Enhanced Product Processing for Better Price Comparison")
    parser.add_argument("--reprocess-all", action="store_true", 
                       help="Reprocess ALL products (clears existing groups)")
    parser.add_argument("--analyze-only", action="store_true", 
                       help="Only analyze current grouping effectiveness")
    parser.add_argument("--test-grouping", action="store_true", 
                       help="Test grouping logic with sample data")
    parser.add_argument("--compare-grouping", action="store_true", 
                       help="Compare old vs new grouping effectiveness")
    
    args = parser.parse_args()
    
    try:
        if args.test_grouping:
            await test_grouping_improvements()
        elif args.compare_grouping:
            await compare_old_vs_new_grouping()
        else:
            await run_enhanced_processing(
                reprocess_all=args.reprocess_all,
                analyze_only=args.analyze_only
            )
            
    except KeyboardInterrupt:
        logger.info("\n⏹️  Processing interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"❌ Script failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    print("🔧 Enhanced Product Processing for Better Price Comparison")
    print("=" * 60)
    print("This script will improve product grouping for better price comparison.")
    print("Products will be grouped more aggressively to show price differences")
    print("across vendors for the same core product.")
    print("")
    
    asyncio.run(main())
