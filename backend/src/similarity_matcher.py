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

        embeddings = self.encoder.encode(self.product_names, batch_size=1024, show_progress_bar=False)

        dimension = embeddings.shape[1]
        # Use IVF index for better performance on large datasets
        nlist = min(100, len(products) // 10)  # Adaptive number of clusters
        if len(products) > 10000:
            quantizer = faiss.IndexFlatL2(dimension)
            self.index = faiss.IndexIVFFlat(quantizer, dimension, nlist)
            self.index.train(embeddings.astype("float32"))
        else:
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

        query_lower = query.lower().strip()
        query_len = len(query_lower)
        results = []

        if query_len <= 2:
            effective_threshold = max(0.2, threshold * 0.3)
        elif query_len <= 4:
            effective_threshold = max(0.4, threshold * 0.6)
        else:
            effective_threshold = threshold

        # Check for exact word matches (whole word boundary)
        exact_word_matches = []
        for idx, name in enumerate(self.product_names):
            name_lower = name.lower()

            if query_len <= 3:
                words = name_lower.split()
                if any(word.startswith(query_lower) for word in words):
                    exact_word_matches.append((self.product_ids[idx], 0.9, name))
                elif name_lower.startswith(query_lower):
                    exact_word_matches.append((self.product_ids[idx], 0.95, name))

            words = name_lower.split()
            if query_lower in words:
                exact_word_matches.append((self.product_ids[idx], 1.0, name))
            elif (
                f" {query_lower} " in f" {name_lower} "
                or name_lower.startswith(f"{query_lower}")
                or name_lower.endswith(f" {query_lower}")
            ):
                exact_word_matches.append((self.product_ids[idx], 0.95, name))

        if exact_word_matches:
            results.extend(exact_word_matches)

        fuzzy_results = self._fuzzy_search(query, k, query_len)

        semantic_results = self._semantic_search(query, k, query_len)

        combined = self._combine_and_deduplicate_results(results + fuzzy_results + semantic_results, effective_threshold)
        return combined[:k]

    def _fuzzy_search(self, query: str, k: int, query_len: int) -> List[Tuple[str, float, str]]:
        """Improved fuzzy string matching with query length awareness"""
        results = []
        
        if query_len is None:
            query_len = len(query.strip())

        # Adjust scoring based on query length
        if query_len <= 3:
            min_score_threshold = 60  # More lenient for short queries
            score_multiplier = 1.2    # Boost scores for short queries
        else:
            min_score_threshold = 70
            score_multiplier = 1.0

        # Strategy 1: Token sort ratio
        token_sort_results = process.extract(
            query, self.product_names, scorer=fuzz.token_sort_ratio, limit=k * 2
        )

        for name, score, idx in token_sort_results:
            if score >= min_score_threshold:
                adjusted_score = (score / 100.0) * score_multiplier
                adjusted_score = min(1.0, adjusted_score)  # Cap at 1.0
                results.append((self.product_ids[idx], adjusted_score, name))

        # Strategy 2: Partial ratio (good for substring matching)
        partial_results = process.extract(
            query, self.product_names, scorer=fuzz.partial_ratio, limit=k * 2
        )

        for name, score, idx in partial_results:
            if score >= min_score_threshold:
                # Partial ratio gets slight penalty since it's less precise
                adjusted_score = (score / 100.0) * 0.9 * score_multiplier
                adjusted_score = min(1.0, adjusted_score)
                results.append((self.product_ids[idx], adjusted_score, name))

        # Strategy 3: Token set ratio
        token_set_results = process.extract(
            query, self.product_names, scorer=fuzz.token_set_ratio, limit=k
        )

        for name, score, idx in token_set_results:
            if score >= min_score_threshold:
                adjusted_score = (score / 100.0) * score_multiplier
                adjusted_score = min(1.0, adjusted_score)
                results.append((self.product_ids[idx], adjusted_score, name))

        return results


    def _semantic_search(self, query: str, k: int, query_len: int) -> List[Tuple[str, float, str]]:
       """Improved semantic similarity search with query length awareness"""
       if self.index is None:
           return []

       if query_len is None:
           query_len = len(query.strip())

       query_embedding = self.encoder.encode([query])
       # Increase k for short queries to get more candidates
       search_k = k * 3 if query_len <= 4 else k * 2
       distances, indices = self.index.search(query_embedding.astype("float32"), search_k)

       results = []
       # Adaptive similarity threshold
       if query_len <= 3:
           min_similarity = 0.25
       elif query_len <= 4:
           min_similarity = 0.35
       else:
           min_similarity = 0.4

       for dist, idx in zip(distances[0], indices[0]):
           if idx < len(self.product_ids) and idx >= 0:
               # Convert L2 distance to similarity score
               similarity = max(0, 1 - (dist / 2))

               if similarity > min_similarity:
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
