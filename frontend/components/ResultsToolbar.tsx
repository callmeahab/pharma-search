"use client";

import React from "react";
import { Layers, ArrowUpDown, List } from "lucide-react";
import { GroupingMode, GroupSortBy } from "@/components/FilterSidebar";
import { cn } from "@/lib/utils";

interface ResultsToolbarProps {
  groupSimilar: boolean;
  groupingMode: GroupingMode;
  sortGroupsBy: GroupSortBy;
  onGroupSimilarChange: (value: boolean) => void;
  onGroupingModeChange: (value: GroupingMode) => void;
  onSortGroupsByChange: (value: GroupSortBy) => void;
  totalGroups: number;
  totalProducts: number;
  loadedGroups?: number;
  className?: string;
}

export const ResultsToolbar: React.FC<ResultsToolbarProps> = ({
  groupSimilar,
  groupingMode,
  sortGroupsBy,
  onGroupSimilarChange,
  onGroupingModeChange,
  onSortGroupsByChange,
  totalGroups,
  totalProducts,
  loadedGroups,
  className,
}) => {
  return (
    <div className={cn(
      "flex items-center gap-2 sm:gap-3 p-2 sm:p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700",
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

      {/* Grouping strictness - compact on mobile */}
      {groupSimilar && (
        <select
          value={groupingMode}
          onChange={(e) => onGroupingModeChange(e.target.value as GroupingMode)}
          className="h-8 px-1.5 sm:px-2 text-xs sm:text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
        >
          <option value="strict">Strogo</option>
          <option value="normal">Normalno</option>
          <option value="loose">Labavo</option>
        </select>
      )}

      {/* Sort dropdown - compact */}
      <div className="flex items-center gap-1">
        <ArrowUpDown className="h-3.5 w-3.5 text-gray-400 hidden sm:block" />
        <select
          value={sortGroupsBy}
          onChange={(e) => onSortGroupsByChange(e.target.value as GroupSortBy)}
          className="h-8 px-1.5 sm:px-2 text-xs sm:text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
        >
          <option value="relevance">Relevantnost</option>
          <option value="price_asc">Cena ↑</option>
          <option value="price_desc">Cena ↓</option>
          <option value="savings">Ušteda</option>
          <option value="vendors">Apoteke</option>
          <option value="products">Proizvodi</option>
        </select>
      </div>

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
    </div>
  );
};

export default ResultsToolbar;
