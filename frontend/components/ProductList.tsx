import React from 'react';
import ProductCard from './ProductCard';
import { Product, BackendProduct } from '@/types/product';

interface ProductListProps {
  products: Product[];
  /** All backend products from search - passed to cards for similarity matching in list mode */
  allProducts?: BackendProduct[];
}

const ProductList: React.FC<ProductListProps> = ({ products, allProducts }) => {
  if (products.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-lg text-gray-600">No products found. Try a different search term.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fade-in">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} allProducts={allProducts} />
      ))}
    </div>
  );
};

export default ProductList;
