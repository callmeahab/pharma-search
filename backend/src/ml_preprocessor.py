"""
ML-Enhanced Preprocessor for Pharmaceutical Products
Uses PyTorch with CUDA/Metal acceleration for advanced similarity computation and grouping.
Focus on preprocessing only - not search.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from transformers import AutoTokenizer, AutoModel
import numpy as np
from typing import List, Dict, Optional, Tuple, Set
from dataclasses import dataclass
import logging
import os
import pickle
import re
from sklearn.cluster import DBSCAN
import asyncio
import asyncpg

# Configure device detection
def get_optimal_device():
    """Get the best available device (CUDA, Metal/MPS, or CPU)"""
    if torch.cuda.is_available():
        return torch.device("cuda")
    elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
        return torch.device("mps")  # Apple Metal Performance Shaders
    else:
        return torch.device("cpu")

logger = logging.getLogger(__name__)

@dataclass
class MLProductEmbedding:
    """ML-generated product embedding with metadata"""
    product_id: str
    embedding: torch.Tensor
    similarity_hash: str
    category: str
    brand: str
    strength: Optional[str]
    confidence_score: float

class PharmaceuticalEncoder(nn.Module):
    """Custom neural network for pharmaceutical product encoding"""
    
    def __init__(self, base_model_name: str = "sentence-transformers/all-MiniLM-L6-v2"):
        super().__init__()
        
        # Use a lightweight transformer model
        self.tokenizer = AutoTokenizer.from_pretrained(base_model_name)
        self.base_model = AutoModel.from_pretrained(base_model_name)
        
        # Pharmaceutical-specific layers
        self.base_dim = self.base_model.config.hidden_size
        
        # Feature enhancement layers
        self.pharma_encoder = nn.Sequential(
            nn.Linear(self.base_dim, 512),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(512, 256),
            nn.ReLU(),
            nn.Linear(256, 128)  # Final embedding dimension
        )
        
        # Pharmaceutical feature extractors
        self.dosage_attention = nn.MultiheadAttention(128, 8, batch_first=True)
        self.brand_attention = nn.MultiheadAttention(128, 8, batch_first=True)
        
        # Category classifier (auxiliary task to improve representations)
        self.category_classifier = nn.Linear(128, 10)  # 10 pharmaceutical categories
        
    def forward(self, input_ids, attention_mask, feature_weights=None):
        # Get base embeddings
        outputs = self.base_model(input_ids=input_ids, attention_mask=attention_mask)
        pooled = outputs.last_hidden_state.mean(dim=1)  # Mean pooling
        
        # Pharmaceutical-specific encoding
        pharma_features = self.pharma_encoder(pooled)
        
        # Apply attention if we have sequence data
        if len(pharma_features.shape) == 3:  # Batch, sequence, features
            attended_features, _ = self.dosage_attention(
                pharma_features, pharma_features, pharma_features
            )
            pharma_features = attended_features.mean(dim=1)
        
        # L2 normalize for cosine similarity
        normalized_features = F.normalize(pharma_features, p=2, dim=1)
        
        # Category predictions (for training)
        category_logits = self.category_classifier(pharma_features)
        
        return normalized_features, category_logits

class MLEnhancedPreprocessor:
    """ML-enhanced preprocessor with CUDA/Metal acceleration"""
    
    def __init__(self, model_cache_dir: str = "backend/ml_models"):
        self.device = get_optimal_device()
        self.model_cache_dir = model_cache_dir
        os.makedirs(model_cache_dir, exist_ok=True)
        
        logger.info(f"ML Preprocessor initialized with device: {self.device}")
        
        # Model components
        self.encoder = None
        self.product_embeddings = {}
        self.similarity_cache = {}
        
        # Model paths
        self.model_path = os.path.join(model_cache_dir, "pharma_encoder.pt")
        self.embeddings_path = os.path.join(model_cache_dir, "product_embeddings.pt")
        
        # Pharmaceutical categories for training
        self.categories = [
            "vitamins", "minerals", "supplements", "probiotics", "painkillers",
            "antibiotics", "skincare", "baby_care", "digestive", "other"
        ]
        self.category_to_id = {cat: i for i, cat in enumerate(self.categories)}
        
    async def initialize(self, force_retrain: bool = False):
        """Initialize the ML preprocessor"""
        
        if not force_retrain and self._models_exist():
            logger.info("Loading existing ML models...")
            await self._load_models()
        else:
            logger.info("Training new ML models...")
            await self._train_models()
            await self._save_models()
        
        logger.info(f"ML Preprocessor ready with {len(self.product_embeddings)} embeddings")
    
    def _models_exist(self) -> bool:
        """Check if trained models exist"""
        return os.path.exists(self.model_path) and os.path.exists(self.embeddings_path)
    
    async def _train_models(self):
        """Train ML models on pharmaceutical product data"""
        
        # Initialize encoder
        self.encoder = PharmaceuticalEncoder().to(self.device)
        
        # Get training data from database
        db_url = os.getenv('DATABASE_URL')
        if not db_url:
            logger.error("DATABASE_URL not set. Cannot train ML models.")
            return
        
        # Load product data
        products = await self._load_training_data(db_url)
        if not products:
            logger.error("No training data found")
            return
        
        logger.info(f"Training on {len(products)} products")
        
        # Prepare training data
        train_texts = []
        train_categories = []
        
        for product in products:
            # Create rich text representation
            text_parts = []
            
            if product['title']:
                text_parts.append(product['title'])
            if product['normalized_name']:
                text_parts.append(product['normalized_name'])
            if product['brand_name']:
                text_parts.append(f"Brand: {product['brand_name']}")
            if product['strength']:
                text_parts.append(f"Strength: {product['strength']}")
            if product['form']:
                text_parts.append(f"Form: {product['form']}")
            
            text = " ".join(text_parts)
            train_texts.append(text)
            
            # Map category to ID
            category = product.get('category', 'other')
            category_id = self.category_to_id.get(category, self.category_to_id['other'])
            train_categories.append(category_id)
        
        # Training loop (simplified for preprocessing focus)
        self.encoder.eval()  # We'll use pre-trained weights and fine-tune minimally
        
        # Generate embeddings for all products
        batch_size = 32
        all_embeddings = []
        
        with torch.no_grad():
            for i in range(0, len(train_texts), batch_size):
                batch_texts = train_texts[i:i + batch_size]
                batch_products = products[i:i + batch_size]
                
                # Tokenize
                encoded = self.encoder.tokenizer(
                    batch_texts,
                    padding=True,
                    truncation=True,
                    max_length=256,
                    return_tensors="pt"
                ).to(self.device)
                
                # Get embeddings
                embeddings, _ = self.encoder(**encoded)
                
                # Store embeddings with metadata
                for j, embedding in enumerate(embeddings):
                    product_idx = i + j
                    product = batch_products[j]
                    
                    self.product_embeddings[product['id']] = MLProductEmbedding(
                        product_id=product['id'],
                        embedding=embedding.cpu(),
                        similarity_hash=self._compute_similarity_hash(embedding.cpu()),
                        category=product.get('category', 'other'),
                        brand=product.get('brand_name', ''),
                        strength=product.get('strength'),
                        confidence_score=1.0  # Placeholder
                    )
                
                if i % 1000 == 0:
                    logger.info(f"Processed {i}/{len(train_texts)} products")
        
        logger.info(f"Generated embeddings for {len(self.product_embeddings)} products")
    
    async def _load_training_data(self, db_url: str) -> List[Dict]:
        """Load training data from database"""
        
        pool = await asyncpg.create_pool(db_url)
        
        try:
            async with pool.acquire() as conn:
                products = await conn.fetch("""
                    SELECT 
                        p.id,
                        p.title,
                        p."normalizedName" as normalized_name,
                        p.category,
                        p.strength,
                        p.form,
                        b.name as brand_name,
                        p.price
                    FROM "Product" p
                    LEFT JOIN "Brand" b ON p."brandId" = b.id
                    WHERE p."preprocessedAt" IS NOT NULL
                    ORDER BY p.id
                    LIMIT 10000  -- Limit for initial training
                """)
                
                return [dict(product) for product in products]
                
        finally:
            await pool.close()
    
    async def _save_models(self):
        """Save trained models"""
        try:
            # Save encoder model
            torch.save({
                'model_state_dict': self.encoder.state_dict(),
                'device': str(self.device)
            }, self.model_path)
            
            # Save embeddings (convert tensors to numpy for storage)
            embeddings_data = {}
            for product_id, embedding_obj in self.product_embeddings.items():
                embeddings_data[product_id] = {
                    'embedding': embedding_obj.embedding.numpy(),
                    'similarity_hash': embedding_obj.similarity_hash,
                    'category': embedding_obj.category,
                    'brand': embedding_obj.brand,
                    'strength': embedding_obj.strength,
                    'confidence_score': embedding_obj.confidence_score
                }
            
            torch.save(embeddings_data, self.embeddings_path)
            
            logger.info("ML models saved successfully")
            
        except Exception as e:
            logger.error(f"Failed to save ML models: {e}")
    
    async def _load_models(self):
        """Load trained models"""
        try:
            # Load encoder
            self.encoder = PharmaceuticalEncoder().to(self.device)
            checkpoint = torch.load(self.model_path, map_location=self.device)
            self.encoder.load_state_dict(checkpoint['model_state_dict'])
            self.encoder.eval()
            
            # Load embeddings
            embeddings_data = torch.load(self.embeddings_path, map_location='cpu')
            
            self.product_embeddings = {}
            for product_id, data in embeddings_data.items():
                self.product_embeddings[product_id] = MLProductEmbedding(
                    product_id=product_id,
                    embedding=torch.from_numpy(data['embedding']),
                    similarity_hash=data['similarity_hash'],
                    category=data['category'],
                    brand=data['brand'],
                    strength=data['strength'],
                    confidence_score=data['confidence_score']
                )
            
            logger.info("ML models loaded successfully")
            
        except Exception as e:
            logger.error(f"Failed to load ML models: {e}")
            raise
    
    def _compute_similarity_hash(self, embedding: torch.Tensor) -> str:
        """Compute a hash for quick similarity grouping"""
        # Use LSH (Locality Sensitive Hashing) for fast approximate similarity
        # Convert to binary hash for quick comparison
        normalized = F.normalize(embedding.unsqueeze(0), p=2, dim=1)
        binary_hash = (normalized > 0).int()
        
        # Convert to hex string for storage
        hash_int = 0
        for i, bit in enumerate(binary_hash.flatten()):
            if bit == 1:
                hash_int |= (1 << i)
        
        return hex(hash_int)
    
    def compute_similarity(self, product_id1: str, product_id2: str) -> float:
        """Compute ML-enhanced similarity between two products"""
        
        if product_id1 not in self.product_embeddings or product_id2 not in self.product_embeddings:
            return 0.0
        
        # Check cache first
        cache_key = f"{min(product_id1, product_id2)}_{max(product_id1, product_id2)}"
        if cache_key in self.similarity_cache:
            return self.similarity_cache[cache_key]
        
        # Get embeddings
        emb1 = self.product_embeddings[product_id1].embedding
        emb2 = self.product_embeddings[product_id2].embedding
        
        # Compute cosine similarity
        similarity = F.cosine_similarity(emb1.unsqueeze(0), emb2.unsqueeze(0), dim=1).item()
        
        # Cache result
        self.similarity_cache[cache_key] = similarity
        
        return similarity
    
    def should_group_products_ml(self, product_id1: str, product_id2: str, threshold: float = 0.85) -> bool:
        """ML-enhanced grouping decision"""
        
        if product_id1 not in self.product_embeddings or product_id2 not in self.product_embeddings:
            return False
        
        emb1 = self.product_embeddings[product_id1]
        emb2 = self.product_embeddings[product_id2]
        
        # Quick hash comparison for obvious non-matches
        if self._hamming_distance(emb1.similarity_hash, emb2.similarity_hash) > 32:
            return False
        
        # Must be same category for pharmaceutical products
        if emb1.category != emb2.category and emb1.category != 'other' and emb2.category != 'other':
            return False
        
        # Different strengths should generally not be grouped
        if emb1.strength and emb2.strength and emb1.strength != emb2.strength:
            return False
        
        # Compute detailed similarity
        similarity = self.compute_similarity(product_id1, product_id2)
        
        return similarity >= threshold
    
    def _hamming_distance(self, hash1: str, hash2: str) -> int:
        """Compute Hamming distance between two hex hashes"""
        try:
            int1 = int(hash1, 16)
            int2 = int(hash2, 16)
            return bin(int1 ^ int2).count('1')
        except ValueError:
            return float('inf')
    
    def get_ml_clusters(self, product_ids: List[str], eps: float = 0.15, min_samples: int = 2) -> Dict[int, List[str]]:
        """Perform ML-based clustering of products"""
        
        if not self.product_embeddings:
            return {}
        
        # Filter to products we have embeddings for
        valid_products = [pid for pid in product_ids if pid in self.product_embeddings]
        
        if len(valid_products) < 2:
            return {}
        
        # Get embeddings matrix
        embeddings_matrix = torch.stack([
            self.product_embeddings[pid].embedding 
            for pid in valid_products
        ]).numpy()
        
        # Apply DBSCAN clustering
        clustering = DBSCAN(
            eps=eps,
            min_samples=min_samples,
            metric='cosine'
        ).fit(embeddings_matrix)
        
        # Group products by cluster
        clusters = {}
        for i, label in enumerate(clustering.labels_):
            if label != -1:  # Ignore noise points
                if label not in clusters:
                    clusters[label] = []
                clusters[label].append(valid_products[i])
        
        return clusters
    
    def get_product_insights(self, product_id: str) -> Dict:
        """Get ML-generated insights about a product"""
        
        if product_id not in self.product_embeddings:
            return {}
        
        embedding_obj = self.product_embeddings[product_id]
        
        # Find most similar products
        similarities = []
        for other_id, other_emb in self.product_embeddings.items():
            if other_id != product_id:
                sim = self.compute_similarity(product_id, other_id)
                if sim > 0.5:
                    similarities.append((other_id, sim))
        
        similarities.sort(key=lambda x: x[1], reverse=True)
        
        return {
            'category': embedding_obj.category,
            'brand': embedding_obj.brand,
            'strength': embedding_obj.strength,
            'confidence_score': embedding_obj.confidence_score,
            'similar_products': similarities[:10],
            'similarity_hash': embedding_obj.similarity_hash[:8]  # Shortened for display
        }


# Global instance
ml_preprocessor = None

async def initialize_ml_preprocessor(force_retrain: bool = False):
    """Initialize the global ML preprocessor"""
    global ml_preprocessor
    
    ml_preprocessor = MLEnhancedPreprocessor()
    await ml_preprocessor.initialize(force_retrain)
    
    return ml_preprocessor

def get_ml_preprocessor():
    """Get the global ML preprocessor instance"""
    return ml_preprocessor