"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import ThemeToggle from "./ThemeToggle";
import SearchBar from "./SearchBar";
import { usePathname, useRouter } from "next/navigation";
import { trackSearch } from "@/utils/analytics";
import { User } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";
import BrandLogo from "./BrandLogo";

const Navbar = () => {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const isLoggedIn = !!user;
  const [urlSearchTerm, setUrlSearchTerm] = useState("");
  const isMobile = useIsMobile();

  // Hydrate search term from URL after mount (legitimate external store sync)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing with URL
      setUrlSearchTerm(params.get("q") || "");
    } catch {
      // ignore
    }
  }, []);

  // Listen for popstate (browser back/forward) to update search term
  useEffect(() => {
    const updateFromUrl = () => {
      try {
        const params = new URLSearchParams(window.location.search);
        setUrlSearchTerm(params.get("q") || "");
      } catch {
        setUrlSearchTerm("");
      }
    };

    window.addEventListener("popstate", updateFromUrl);
    return () => window.removeEventListener("popstate", updateFromUrl);
  }, []);


  const handleSearch = (term: string) => {
    if (term && term.trim()) {
      trackSearch(term, 0); // Results count will be determined on the main page

      // If we're not on the home page, navigate there with the search term
      if (pathname !== "/") {
        router.push(`/?q=${encodeURIComponent(term.trim())}`);
        return;
      }

      // If we're already on the home page, just update the URL and dispatch event
      const url = new URL(window.location.origin + pathname);
      url.searchParams.set("q", term.trim());
      window.history.replaceState(null, "", url.toString());
    } else {
      // Clear search - navigate to home page
      if (pathname !== "/") {
        router.push("/");
        return;
      }

      // If already on home page, just clear the URL
      const url = new URL(window.location.origin + pathname);
      url.searchParams.delete("q");
      window.history.replaceState(null, "", url.toString());
    }

    // Dispatch a custom event to notify other components about URL change
    window.dispatchEvent(
      new CustomEvent("urlSearchChanged", {
        detail: { searchTerm: term },
      })
    );
  };

  return (
    <nav className="bg-white shadow-sm py-4 dark:bg-gray-800 dark:border-b dark:border-gray-700 transition-colors duration-200">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row justify-between items-center">
          <div className="w-full flex justify-between items-center mb-4 md:mb-0 md:w-auto md:flex-shrink-0">
            <Link
              href="/"
              className="flex items-center justify-start rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-health-primary focus-visible:ring-offset-2 dark:focus-visible:ring-health-accent dark:focus-visible:ring-offset-gray-800"
              onClick={(e) => {
                e.preventDefault();
                handleSearch("");
                if (pathname !== "/") {
                  router.push("/");
                }
              }}
            >
              <BrandLogo markClassName="h-9 w-9 md:h-10 md:w-10" />
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

          <div className="flex-grow mx-0 md:mx-6 max-w-full md:max-w-3xl w-full">
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
