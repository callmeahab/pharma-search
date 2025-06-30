import numpy as np
from typing import List, Tuple, Dict, Optional
from rapidfuzz import fuzz, process
from sentence_transformers import SentenceTransformer
import faiss
import logging
import pickle
import os
from pathlib import Path

logger = logging.getLogger(__name__)


class SimilarityMatcher:
    """Advanced similarity matching for pharmaceutical products"""

    def __init__(
        self,
        model_name: str = "paraphrase-multilingual-MiniLM-L12-v2",
        cache_dir: str = "cache",
    ):
        self.encoder = SentenceTransformer(model_name)
        self.index = None
        self.product_names = []
        self.product_ids = []
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(exist_ok=True)

    def _get_cache_paths(self):
        """Get paths for cache files"""
        return {
            "index": self.cache_dir / "faiss_index.bin",
            "metadata": self.cache_dir / "index_metadata.pkl",
        }

    def save_index(self) -> bool:
        """Save FAISS index and metadata to disk"""
        if self.index is None:
            logger.warning("No index to save")
            return False

        try:
            paths = self._get_cache_paths()

            # Save FAISS index
            faiss.write_index(self.index, str(paths["index"]))

            # Save metadata
            metadata = {
                "product_names": self.product_names,
                "product_ids": self.product_ids,
                "model_name": (
                    self.encoder.model_name
                    if hasattr(self.encoder, "model_name")
                    else "unknown"
                ),
            }

            with open(paths["metadata"], "wb") as f:
                pickle.dump(metadata, f)

            logger.info(f"Index saved to {self.cache_dir}")
            return True

        except Exception as e:
            logger.error(f"Failed to save index: {e}")
            return False

    def load_index(self) -> bool:
        """Load FAISS index and metadata from disk"""
        try:
            paths = self._get_cache_paths()

            if not paths["index"].exists() or not paths["metadata"].exists():
                logger.info("No cached index found")
                return False

            # Load FAISS index
            self.index = faiss.read_index(str(paths["index"]))

            # Load metadata
            with open(paths["metadata"], "rb") as f:
                metadata = pickle.load(f)

            self.product_names = metadata["product_names"]
            self.product_ids = metadata["product_ids"]

            logger.info(
                f"Index loaded from cache with {len(self.product_names)} products"
            )
            return True

        except Exception as e:
            logger.error(f"Failed to load index: {e}")
            return False

    def is_cache_valid(self, products: List[Dict]) -> bool:
        """Check if cached index is still valid for current products"""
        if not self.product_ids:
            return False

        current_ids = set(p["id"] for p in products)
        cached_ids = set(self.product_ids)

        # Simple check: same number of products and all IDs match
        if len(current_ids) != len(cached_ids) or current_ids != cached_ids:
            logger.info("Cache invalid: product set has changed")
            return False

        logger.info("Cache is valid")
        return True

    def build_index(self, products: List[Dict], use_cache: bool = True) -> None:
        """Build FAISS index for semantic search"""

        # Try to load from cache first
        if use_cache and self.load_index() and self.is_cache_valid(products):
            return

        logger.info(f"Building index for {len(products)} products")

        self.product_names = [p["normalized_name"] for p in products]
        self.product_ids = [p["id"] for p in products]

        embeddings = self.encoder.encode(self.product_names)

        dimension = embeddings.shape[1]
        self.index = faiss.IndexFlatL2(dimension)
        self.index.add(embeddings.astype("float32"))

        logger.info("Index built successfully")

        # Save to cache
        if use_cache:
            self.save_index()

    def find_similar_products(
        self, query: str, k: int = 10, threshold: float = 0.8
    ) -> List[Tuple[str, float, str]]:
        """Find similar products using both fuzzy and semantic search"""

        fuzzy_results = self._fuzzy_search(query, k * 2)
        semantic_results = self._semantic_search(query, k * 2)
        combined = self._combine_results(fuzzy_results, semantic_results)
        filtered = [
            (id, score, name) for id, score, name in combined if score >= threshold
        ]

        return filtered[:k]

    def _fuzzy_search(self, query: str, k: int) -> List[Tuple[str, float, str]]:
        """Fuzzy string matching"""
        results = []

        token_sort_results = process.extract(
            query, self.product_names, scorer=fuzz.token_sort_ratio, limit=k
        )

        for name, score, idx in token_sort_results:
            results.append((self.product_ids[idx], score / 100.0, name))

        partial_results = process.extract(
            query, self.product_names, scorer=fuzz.partial_ratio, limit=k
        )

        for name, score, idx in partial_results:
            results.append((self.product_ids[idx], score / 100.0, name))

        return results

    def _semantic_search(self, query: str, k: int) -> List[Tuple[str, float, str]]:
        """Semantic similarity search using embeddings"""
        if self.index is None:
            return []

        query_embedding = self.encoder.encode([query])
        distances, indices = self.index.search(query_embedding.astype("float32"), k)

        results = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx < len(self.product_ids):
                similarity = 1 / (1 + dist)
                results.append(
                    (self.product_ids[idx], similarity, self.product_names[idx])
                )

        return results

    def _combine_results(
        self,
        fuzzy_results: List[Tuple[str, float, str]],
        semantic_results: List[Tuple[str, float, str]],
    ) -> List[Tuple[str, float, str]]:
        """Combine and deduplicate results from different methods"""
        combined_scores = {}
        product_names = {}

        for product_id, score, name in fuzzy_results:
            if product_id not in combined_scores:
                combined_scores[product_id] = 0
                product_names[product_id] = name
            combined_scores[product_id] += score * 0.6

        for product_id, score, name in semantic_results:
            if product_id not in combined_scores:
                combined_scores[product_id] = 0
                product_names[product_id] = name
            combined_scores[product_id] += score * 0.4

        sorted_results = sorted(
            [(id, score, product_names[id]) for id, score in combined_scores.items()],
            key=lambda x: x[1],
            reverse=True,
        )

        return sorted_results
