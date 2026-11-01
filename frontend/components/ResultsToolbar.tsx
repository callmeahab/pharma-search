"use client";

import React from "react";
import { Layers, List } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CatalogSort } from "@/lib/catalog";

interface ResultsToolbarProps {
  groupSimilar: boolean;
  onGroupSimilarChange: (value: boolean) => void;
  totalGroups: number;
  totalProducts: number;
  loadedGroups?: number;
  className?: string;
  sort?: CatalogSort;
  onSortChange?: (sort: CatalogSort) => void;
}

export const ResultsToolbar: React.FC<ResultsToolbarProps> = ({
  groupSimilar,
  onGroupSimilarChange,
  totalGroups,
  totalProducts,
  loadedGroups,
  className,
  sort = "relevance", onSortChange,
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
          ? "Poredimo potvrđeno iste proizvode i pakovanja. Nepotvrđene listinge prikazujemo odvojeno."
          : "Prikazane su sve ponude, uključujući više listinga istog prodavca."}
      </div>
      {onSortChange && <label className="flex items-center gap-2 text-sm">Sortiranje<select value={sort} onChange={event => onSortChange(event.target.value as CatalogSort)} className="rounded border bg-white p-2 dark:bg-gray-800 dark:border-gray-700"><option value="relevance">Relevantnost</option><option value="price_asc">Najniža cena</option><option value="price_desc">Najviša cena</option><option value="coverage">Broj prodavaca</option><option value="newest">Najnovije cene</option></select></label>}
    </div>
  );
};

export default ResultsToolbar;
