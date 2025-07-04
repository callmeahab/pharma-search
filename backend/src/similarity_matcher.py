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

        query_lower = query.lower()
        results = []

        # Check for exact word matches (whole word boundary)
        exact_word_matches = []
        for idx, name in enumerate(self.product_names):
            name_lower = name.lower()
            # Check if query appears as a whole word
            words = name_lower.split()
            if query_lower in words:
                exact_word_matches.append((self.product_ids[idx], 1.0, name))
            # Also check if query is at word boundaries
            elif (
                f" {query_lower} " in f" {name_lower} "
                or name_lower.startswith(f"{query_lower} ")
                or name_lower.endswith(f" {query_lower}")
            ):
                exact_word_matches.append((self.product_ids[idx], 0.95, name))

        if exact_word_matches:
            logger.info(
                f"Found {len(exact_word_matches)} exact word matches for '{query}'"
            )
            results.extend(exact_word_matches)

        # Get fuzzy matches
        fuzzy_results = self._fuzzy_search(query, k)

        # Get semantic matches
        semantic_results = self._semantic_search(query, k)

        # Combine all results
        combined = self._combine_and_deduplicate_results(
            results + fuzzy_results + semantic_results, threshold
        )

        return combined[:k]

    def _fuzzy_search(self, query: str, k: int) -> List[Tuple[str, float, str]]:
        """Fuzzy string matching with multiple strategies"""
        results = []

        # Strategy 1: Token sort ratio - good for reordered words
        token_sort_results = process.extract(
            query, self.product_names, scorer=fuzz.token_sort_ratio, limit=k
        )

        for name, score, idx in token_sort_results:
            # Apply penalty if it's not a good match
            adjusted_score = score / 100.0
            if score < 80:  # Lower quality matches get penalized
                adjusted_score *= 0.8
            results.append((self.product_ids[idx], adjusted_score, name))

        # Strategy 2: Token set ratio - good for subset matching
        token_set_results = process.extract(
            query, self.product_names, scorer=fuzz.token_set_ratio, limit=k
        )

        for name, score, idx in token_set_results:
            adjusted_score = score / 100.0
            if score < 85:
                adjusted_score *= 0.85
            results.append((self.product_ids[idx], adjusted_score, name))

        return results

    def _semantic_search(self, query: str, k: int) -> List[Tuple[str, float, str]]:
        """Semantic similarity search using embeddings"""
        if self.index is None:
            return []

        query_embedding = self.encoder.encode([query])
        distances, indices = self.index.search(query_embedding.astype("float32"), k)

        results = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx < len(self.product_ids) and idx >= 0:
                # Convert L2 distance to similarity score
                # Normalize distance to 0-1 range (lower distance = higher similarity)
                # Typical distances range from 0 to 2
                similarity = max(0, 1 - (dist / 2))

                # Apply threshold - semantic matches should be quite good
                if similarity > 0.4:  # Roughly equivalent to old threshold
                    results.append(
                        (self.product_ids[idx], similarity, self.product_names[idx])
                    )

        return results

    def _combine_and_deduplicate_results(
        self, all_results: List[Tuple[str, float, str]], threshold: float
    ) -> List[Tuple[str, float, str]]:
        """Combine results from different methods and deduplicate"""
        # Group by product ID and take maximum score
        best_scores = {}
        product_names = {}

        for product_id, score, name in all_results:
            if product_id not in best_scores or score > best_scores[product_id]:
                best_scores[product_id] = score
                product_names[product_id] = name

        # Create final results list
        combined = [
            (pid, score, product_names[pid])
            for pid, score in best_scores.items()
            if score >= threshold
        ]

        # Sort by score descending
        combined.sort(key=lambda x: x[1], reverse=True)

        return combined

    def _combine_results(
        self,
        fuzzy_results: List[Tuple[str, float, str]],
        semantic_results: List[Tuple[str, float, str]],
    ) -> List[Tuple[str, float, str]]:
        """Legacy method for backwards compatibility"""
        return self._combine_and_deduplicate_results(
            fuzzy_results + semantic_results,
            threshold=0.0,  # No threshold here, applied elsewhere
        )
