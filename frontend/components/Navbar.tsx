"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import ThemeToggle from "./ThemeToggle";
import SearchBar from "./SearchBar";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { trackSearch } from "@/utils/analytics";
import { User } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import Link from "next/link";

const Navbar = () => {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [updateUrlTimeout, setUpdateUrlTimeout] =
    useState<NodeJS.Timeout | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const isMobile = useIsMobile();

  // Get URLSearchParams to extract current search term from URL
  const urlSearchTerm = searchParams?.get("search") || "";

  // Check if user is logged in on component mount
  useEffect(() => {
    const userLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    setIsLoggedIn(userLoggedIn);
  }, []);

  // Listen for login status changes
  useEffect(() => {
    const handleStorageChange = () => {
      const userLoggedIn = localStorage.getItem("isLoggedIn") === "true";
      setIsLoggedIn(userLoggedIn);
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // Clean up timeouts on component unmount
  useEffect(() => {
    return () => {
      if (updateUrlTimeout) {
        clearTimeout(updateUrlTimeout);
      }
    };
  }, [updateUrlTimeout]);

  const handleSearch = (term: string) => {
    console.log("Search triggered with term:", term);

    // Clear any existing timeout
    if (updateUrlTimeout) {
      clearTimeout(updateUrlTimeout);
    }

    // Only update URL and navigate after typing stops
    const timeoutId = setTimeout(() => {
      // Create a new URL object from the current pathname only
      const url = new URL(window.location.origin + pathname);

      // Update or remove the search parameter based on the term
      if (term && term.trim()) {
        url.searchParams.set("search", term);
        trackSearch(term, 0); // Results count will be determined on the main page
      } else {
        url.searchParams.delete("search");
      }

      // Update the URL without causing navigation or page refresh
      window.history.replaceState(null, "", url.toString());

      // Dispatch a custom event to notify other components about URL change
      window.dispatchEvent(
        new CustomEvent("urlSearchChanged", {
          detail: { term },
        })
      );
    }, 300); // Wait 300ms before updating URL

    setUpdateUrlTimeout(timeoutId);
  };

  return (
    <nav className="bg-white shadow-sm py-4 dark:bg-gray-800 dark:border-b dark:border-gray-700 transition-colors duration-200">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row justify-between items-center">
          <div className="w-full flex justify-between items-center mb-4 md:mb-0 md:w-auto">
            <Link href="/" className="flex items-center">
              <span className="text-green-400 dark:text-green-300 font-bold text-2xl">
                Apo
              </span>
              <span className="text-yellow-400 font-bold text-2xl">$</span>
              <span className="text-green-700 dark:text-green-400 font-bold text-2xl">
                teka
              </span>
            </Link>

            {isMobile && (
              <div className="flex items-center">
                <ThemeToggle />

                {isLoggedIn ? (
                  <Button
                    variant="outline"
                    className="ml-2 border-health-primary text-health-primary hover:bg-health-light dark:border-health-accent dark:text-health-accent dark:hover:bg-gray-700"
                    onClick={() => router.push("/profil")}
                  >
                    <User className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="ml-2 border-health-primary text-health-primary hover:bg-health-light dark:border-health-accent dark:text-health-accent dark:hover:bg-gray-700"
                    onClick={() => router.push("/prijava")}
                  >
                    Prijava
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="flex-grow mx-0 md:mx-4 max-w-full md:max-w-3xl w-full">
            <SearchBar onSearch={handleSearch} initialTerm={urlSearchTerm} />
          </div>

          {!isMobile && (
            <div className="hidden md:flex items-center mt-4 md:mt-0">
              <ThemeToggle />

              {isLoggedIn ? (
                <Button
                  variant="outline"
                  className="ml-4 border-health-primary text-health-primary hover:bg-health-light dark:border-health-accent dark:text-health-accent dark:hover:bg-gray-700"
                  onClick={() => router.push("/profil")}
                >
                  <User className="mr-2 h-4 w-4" />
                  Profil
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="ml-4 border-health-primary text-health-primary hover:bg-health-light dark:border-health-accent dark:text-health-accent dark:hover:bg-gray-700"
                  onClick={() => router.push("/prijava")}
                >
                  Prijava
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
