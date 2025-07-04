import React from "react";

interface ProductSkeletonProps {
  count?: number;
}

export default function ProductSkeleton({ count = 6 }: ProductSkeletonProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {[...Array(count)].map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
            {/* Image skeleton */}
            <div className="bg-gray-200 dark:bg-gray-700 rounded-lg h-48 mb-4"></div>

            {/* Title skeleton */}
            <div className="space-y-2 mb-4">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
            </div>

            {/* Price skeleton */}
            <div className="flex justify-between items-center mb-4">
              <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-24"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
            </div>

            {/* Button skeleton */}
            <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded"></div>
          </div>
        </div>
      ))}
    </div>
  );
}
