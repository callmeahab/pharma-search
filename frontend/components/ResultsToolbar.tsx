"use client";

import React from "react";
import { Layers, List } from "lucide-react";
import { cn } from "@/lib/utils";

interface ResultsToolbarProps {
  groupSimilar: boolean;
  onGroupSimilarChange: (value: boolean) => void;
  totalGroups: number;
  totalProducts: number;
  loadedGroups?: number;
  className?: string;
}

export const ResultsToolbar: React.FC<ResultsToolbarProps> = ({
  groupSimilar,
  onGroupSimilarChange,
  totalGroups,
  totalProducts,
  loadedGroups,
  className,
}) => {
  return (
    <div className={cn(
      "flex flex-wrap items-center gap-2 sm:gap-3 p-2 sm:p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700",
      className
    )}>
      {/* Group toggle - icon only on mobile */}
      <button
        onClick={() => onGroupSimilarChange(!groupSimilar)}
        className={cn(
          "flex items-center gap-1.5 h-8 px-2 sm:px-3 rounded-md text-sm font-medium transition-colors",
          groupSimilar
            ? "bg-health-primary text-white hover:bg-health-secondary"
            : "bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600"
        )}
      >
        {groupSimilar ? <Layers className="h-4 w-4" /> : <List className="h-4 w-4" />}
        <span className="hidden sm:inline">{groupSimilar ? "Grupisano" : "Lista"}</span>
      </button>

      {/* Results count - compact on mobile */}
      <div className="ml-auto text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
        {groupSimilar ? (
          <>
            <span className="sm:hidden">
              {loadedGroups !== undefined && loadedGroups < totalGroups
                ? `${loadedGroups}/${totalGroups}g`
                : `${totalGroups}g`
              } ({totalProducts}p)
            </span>
            <span className="hidden sm:inline">
              {loadedGroups !== undefined && loadedGroups < totalGroups
                ? `${loadedGroups} od ${totalGroups} grupa`
                : `${totalGroups} grupa`
              } ({totalProducts} proizvoda)
            </span>
          </>
        ) : (
          <span>{totalProducts} proizvoda</span>
        )}
      </div>

      <div className="basis-full text-xs text-gray-500 dark:text-gray-400 sm:basis-auto sm:ml-2">
        {groupSimilar
          ? "Spajamo isti proizvod po dozi i pakovanju i prikazujemo najnižu cenu po apoteci."
          : "Svaka ponuda je zasebna, ali i dalje zadržava kontekst svoje grupe za poređenje."}
      </div>
    </div>
  );
};

export default ResultsToolbar;
