from dataclasses import dataclass, field
from typing import List, Optional, Dict
from datetime import datetime


@dataclass
class ExtractedAttributes:
    """Extracted product attributes"""

    brand: Optional[str] = None
    product_name: Optional[str] = None
    dosage_value: Optional[float] = None
    dosage_unit: Optional[str] = None
    quantity: Optional[int] = None
    quantity_unit: Optional[str] = None
    form: Optional[str] = None
    volume: Optional[float] = None
    volume_unit: Optional[str] = None
    confidence_scores: Dict[str, float] = field(default_factory=dict)


@dataclass
class ProcessedProduct:
    """Fully processed product"""

    original_title: str
    normalized_name: str
    attributes: ExtractedAttributes
    search_tokens: List[str]
    group_key: str
    embedding: Optional[List[float]] = None


@dataclass
class SearchResult:
    """Search result model"""

    groups: List[Dict]
    total: int
    offset: int
    limit: int
