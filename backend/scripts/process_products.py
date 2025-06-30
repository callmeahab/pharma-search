import asyncio
import logging
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

from src.product_processor import ProductProcessor
from src.config import settings

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)


async def main():
    """Process all products"""
    processor = ProductProcessor(settings.database_url)

    try:
        await processor.connect()
        await processor.process_products(batch_size=settings.batch_size)
    finally:
        await processor.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
