import React, { useState, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCategories, Category } from "@/lib/api";
import {
  Pill,
  Tablets,
  Circle,
  Beaker,
  Stethoscope,
  HeartPulse,
  Banana,
  Leaf,
  Dumbbell,
  Baby,
} from "lucide-react";

interface CategoryFilterProps {
  onSelectCategory: (category: string | null) => void;
  selectedCategory: string | null;
}

const CategoryFilter: React.FC<CategoryFilterProps> = ({
  onSelectCategory,
  selectedCategory,
}) => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch categories from API
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const apiCategories = await getCategories();
        setCategories(apiCategories);
      } catch (error) {
        console.error("Failed to fetch categories:", error);
        // Fallback to empty categories
        setCategories([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCategories();
  }, []);

  // Map for category icons
  const categoryIcons: Record<string, React.ReactNode> = {
    Vitamins: <Pill className="h-4 w-4 mr-2" />,
    Supplements: <Tablets className="h-4 w-4 mr-2" />,
    Medications: <Tablets className="h-4 w-4 mr-2" />,
    Wellness: <HeartPulse className="h-4 w-4 mr-2" />,
    Fitness: <Dumbbell className="h-4 w-4 mr-2" />,
    Natural: <Leaf className="h-4 w-4 mr-2" />,
    Baby: <Baby className="h-4 w-4 mr-2" />,
    Food: <Banana className="h-4 w-4 mr-2" />,
    Medical: <Stethoscope className="h-4 w-4 mr-2" />,
    Lab: <Beaker className="h-4 w-4 mr-2" />,
    Proteins: <Circle className="h-4 w-4 mr-2" />,
    Minerals: <Circle className="h-4 w-4 mr-2" />,
    Herbs: <Leaf className="h-4 w-4 mr-2" />,
  };

  if (isLoading) {
    return (
      <div className="mb-6">
        <h3 className="text-lg font-medium mb-3 text-gray-800 dark:text-gray-200">
          Categories
        </h3>
        <div className="animate-pulse">
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <h3 className="text-lg font-medium mb-3 text-gray-800 dark:text-gray-200">
        Categories
      </h3>
      <Tabs
        defaultValue="all"
        value={selectedCategory || "all"}
        onValueChange={(val) => onSelectCategory(val === "all" ? null : val)}
        className="w-full"
      >
        <div className="overflow-x-auto pb-2 -mx-4 px-4">
          <TabsList className="flex flex-nowrap mb-2 min-w-max">
            <TabsTrigger value="all" className="flex items-center">
              <span className="whitespace-nowrap">All Categories</span>
            </TabsTrigger>

            {categories.map((category) => (
              <TabsTrigger
                key={category.name}
                value={category.name}
                className="flex items-center"
              >
                {categoryIcons[category.name] || null}
                <span className="whitespace-nowrap">
                  {category.name} ({category.count})
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>
    </div>
  );
};

export default CategoryFilter;
