import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Humanizes a string by converting it to title case
 * Handles special cases for pharmaceutical terms
 */
export function humanizeTitle(title: string): string {
  if (!title) return title;

  // Words that should remain lowercase (prepositions, articles, etc.)
  const lowercaseWords = new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "for",
    "nor",
    "on",
    "at",
    "to",
    "from",
    "by",
    "with",
    "of",
    "in",
  ]);

  // Common pharmaceutical abbreviations that should be uppercase
  const uppercaseWords = new Set([
    "mg",
    "mcg",
    "iu",
    "ml",
    "g",
    "kg",
    "b1",
    "b2",
    "b6",
    "b12",
    "c",
    "d",
    "d3",
    "k",
    "k2",
    "dha",
    "epa",
    "coq10",
  ]);

  return title
    .toLowerCase()
    .split(" ")
    .map((word, index) => {
      // Remove any non-alphanumeric characters for checking
      const cleanWord = word.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

      // First word is always capitalized
      if (index === 0) {
        if (uppercaseWords.has(cleanWord)) {
          return word.toUpperCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
      }

      // Check if it should be uppercase (pharmaceutical terms)
      if (uppercaseWords.has(cleanWord)) {
        return word.toUpperCase();
      }

      // Check if it should remain lowercase
      if (lowercaseWords.has(cleanWord)) {
        return word.toLowerCase();
      }

      // Default: capitalize first letter
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * Formats a price in Serbian Dinar (RSD)
 */
export function formatPrice(price: number): string {
  return new Intl.NumberFormat("sr-RS", {
    style: "currency",
    currency: "RSD",
    minimumFractionDigits: 0,
  }).format(price);
}
