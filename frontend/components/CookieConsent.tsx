"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { setCookieConsent } from "@/utils/analytics";

const CookieConsent = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Check if user has already set cookie preferences
    const hasConsent = localStorage.getItem("cookie-consent");
    if (!hasConsent) {
      // Show consent banner after a short delay
      const timer = setTimeout(() => {
        setVisible(true);
        // Auto-set consent since analytics are required
        setCookieConsent(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  const acceptCookies = () => {
    localStorage.setItem("cookie-consent", "accepted");
    setCookieConsent(true);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 p-4 md:p-6 shadow-lg border-t border-gray-200 dark:border-gray-700 z-50">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex-1">
          <h3 className="font-medium text-lg mb-2">
            Ova web stranica koristi kolačiće
          </h3>
          <p className="text-gray-600 dark:text-gray-300 text-sm">
            Koristimo neophodne analitičke kolačiće kako bismo poboljšali vaše
            iskustvo i analizirali saobraćaj na web stranici. Ovi kolačići su
            neophodni za pravilno funkcionisanje web stranice i ne mogu se
            isključiti.
          </p>
        </div>
        <div className="flex items-center gap-3 self-end md:self-center">
          <Button
            onClick={acceptCookies}
            className="text-sm bg-health-primary hover:bg-health-secondary"
          >
            Razumem
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setVisible(false)}
            className="rounded-full h-8 w-8"
          >
            <X size={18} />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CookieConsent;
