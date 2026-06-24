import React from "react";

interface ProductSkeletonProps {
  count?: number;
}

export default function ProductSkeleton({ count = 6 }: ProductSkeletonProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {[...Array(count)].map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 flex flex-col gap-4"
        >
          {/* Image */}
          <div className="bg-gray-200 dark:bg-gray-700 rounded-lg h-48" />

          {/* Title (2 lines) */}
          <div className="space-y-2">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
          </div>

          {/* "Već od" label + price + vendor count */}
          <div className="flex items-end justify-between">
            <div className="space-y-2">
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-12" />
              <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-24" />
            </div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20" />
          </div>

          {/* Comparison summary box */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
          </div>

          {/* Button */}
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded-md mt-auto" />
        </div>
      ))}
    </div>
  );
}
