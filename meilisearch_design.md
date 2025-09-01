# Meilisearch Implementation Design for Pharmaceutical Search

## Why Meilisearch Solves Our Problems

### Current Issues
- **Over-engineering**: Complex attribute extraction fails frequently
- **Missing products**: Rigid exact matching loses products 
- **Poor UX**: Users can't find variations of what they want
- **No flexibility**: Can't handle typos, synonyms, or partial matches

### Meilisearch Benefits
- **Typo tolerance**: "ibuprofn" finds "ibuprofen"
- **Fuzzy matching**: Handles brand variations automatically
- **Instant search**: Results as you type
- **Faceted filtering**: Filter by brand, price, form, etc.
- **Relevance ranking**: Best matches first
- **Simple setup**: No complex SQL joins

## Index Structure Design

### 1. Primary Product Document
```json
{
  "id": "product_123456",
  "title": "La Roche Posay Effaclar Duo+ Cream 40ml",
  "normalizedTitle": "la roche posay effaclar duo cream 40ml",
  "price": 2500,  // in cents for exact filtering
  "category": "skincare",
  
  // Search fields (searchable)
  "searchableText": "la roche posay effaclar duo cream acne treatment skincare dermatology",
  "brand": "La Roche Posay",
  "productLine": "Effaclar",
  "genericName": "acne treatment cream",
  
  // Facet filters (filterable attributes)
  "brandFacet": "La Roche Posay",
  "categoryFacet": "skincare",
  "formFacet": "cream",
  "volumeRange": "small",        // 1-50ml
  "priceRange": "medium",        // 2000-5000 cents
  "spfRange": null,
  "prescriptionRequired": false,
  
  // Extracted attributes (when available)
  "dosageValue": null,
  "dosageUnit": null,
  "volumeValue": 40,
  "volumeUnit": "ml",
  "activeIngredients": ["niacinamide", "salicylic acid"],
  
  // Additional metadata
  "description": "Dual corrective treatment for acne-prone skin",
  "tags": ["acne", "oily skin", "blemishes", "dermatologist recommended"],
  "inStock": true,
  "imageUrl": "https://example.com/image.jpg"
}
```

### 2. Facet Categories Design

**Brand Facets**
- Normalize common variations: "LA ROCHE POSAY" = "La Roche Posay" 
- Handle abbreviations: "LRP" = "La Roche Posay"

**Volume Ranges** (better than exact values)
- "mini": 1-30ml
- "small": 31-100ml 
- "medium": 101-300ml
- "large": 301-500ml
- "xl": 500ml+

**Price Ranges**
- "budget": 0-1000 cents
- "affordable": 1001-3000 cents
- "premium": 3001-6000 cents
- "luxury": 6000+ cents

**Form Categories**
- "oral": tablet, capsule, syrup, drops
- "topical": cream, gel, lotion, ointment
- "spray": nasal spray, throat spray, aerosol
- "injectable": ampoule, vial, syringe

## Configuration Settings

### 1. Searchable Attributes (ranking order)
```json
{
  "searchableAttributes": [
    "title",           // Highest priority
    "brand", 
    "productLine",
    "searchableText",   // Expanded keywords
    "genericName",
    "description",
    "tags"            // Lowest priority
  ]
}
```

### 2. Filterable Attributes
```json
{
  "filterableAttributes": [
    "brandFacet",
    "categoryFacet", 
    "formFacet",
    "volumeRange",
    "priceRange",
    "spfRange",
    "prescriptionRequired",
    "inStock",
    "price"  // For exact price filtering
  ]
}
```

### 3. Sortable Attributes
```json
{
  "sortableAttributes": [
    "price",
    "title",
    "brand"
  ]
}
```

### 4. Ranking Rules (custom)
```json
{
  "rankingRules": [
    "words",      // Match all query words
    "typo",       // Fewer typos = higher rank
    "proximity",  // Words closer together = higher rank
    "attribute",  // Title matches > description matches
    "sort",       // Custom sort (price, etc.)
    "exactness"   // Exact matches = higher rank
  ]
}
```

### 5. Synonyms Configuration
```json
{
  "synonyms": {
    "acetaminophen": ["paracetamol", "tylenol"],
    "ibuprofen": ["advil", "brufen", "nurofen"],
    "vitamin d": ["vitamin d3", "cholecalciferol"],
    "omega 3": ["omega3", "fish oil", "dha", "epa"],
    "spf": ["sun protection factor", "sunscreen"],
    "ml": ["milliliter", "milliliters"],
    "mg": ["milligram", "milligrams"]
  }
}
```

### 6. Typo Tolerance
```json
{
  "typoTolerance": {
    "enabled": true,
    "minWordSizeForTypos": {
      "oneTypo": 4,   // Allow 1 typo for words >= 4 chars
      "twoTypos": 8   // Allow 2 typos for words >= 8 chars
    }
  }
}
```

## Example Search Queries

### 1. Basic Search
```javascript
// User types: "la roche effaclar cream"
const results = await meiliClient.index('products').search('la roche effaclar cream', {
  limit: 20,
  attributesToHighlight: ['title', 'brand'],
  facetDistribution: ['brandFacet', 'formFacet', 'priceRange']
});
```

### 2. Faceted Search
```javascript
// User searches + filters by brand and form
const results = await meiliClient.index('products').search('acne treatment', {
  facetFilters: [
    ['brandFacet:La Roche Posay'],
    ['formFacet:cream']
  ],
  facetDistribution: ['priceRange', 'volumeRange']
});
```

### 3. Price Range Filtering  
```javascript
// Find products between 20-50 euros (2000-5000 cents)
const results = await meiliClient.index('products').search('vitamin d', {
  filter: 'price >= 2000 AND price <= 5000',
  sort: ['price:asc']
});
```

### 4. Availability + Multi-filter
```javascript
// In stock + multiple brands
const results = await meiliClient.index('products').search('omega 3', {
  facetFilters: [
    ['brandFacet:Solgar', 'brandFacet:Now Foods'],  // OR within array
    ['inStock:true']  // AND with other arrays
  ]
});
```

## Data Pipeline

### 1. Product Ingestion Process
```
PostgreSQL Products 
    ↓
Extract/Transform (simplified)
    ↓  
Meilisearch Index
    ↓
Real-time Search API
```

### 2. Simplified Attribute Extraction
Instead of complex regex-based extraction:
- Use simple keyword matching for brands
- Categorize volumes into ranges  
- Focus on searchable text enrichment
- Let Meilisearch handle the complexity

### 3. Index Update Strategy
- **Bulk import**: Initial load of all products
- **Real-time updates**: When products change
- **Incremental sync**: Nightly synchronization

## Implementation Benefits

### vs Current Approach
- **90% less complexity**: No complex SQL joins or exact matching
- **Better coverage**: Finds products even with failed attribute extraction  
- **Flexible search**: Handles typos, synonyms, partial matches
- **Fast performance**: Sub-50ms search responses
- **Better UX**: Instant search, faceted filtering, relevance ranking

### Real-world Examples
```
Current: "LA ROCHE POSAY EFFACLAR" → might miss "La Roche-Posay Effaclar"
Meilisearch: "la roche effaclar" → finds all variations

Current: "ibuprofn 200mg" → no results  
Meilisearch: "ibuprofn" → finds "ibuprofen" products

Current: Complex grouping fails → over-grouped results
Meilisearch: Natural ranking → most relevant results first
```

## Next Steps
1. Set up Meilisearch instance
2. Create index with this structure  
3. Implement data transformation pipeline
4. Build search API with faceted filtering
5. Test search quality vs current PostgreSQL approach