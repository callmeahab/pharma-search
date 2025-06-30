"use client";

import { Metadata } from "next";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import UserSettings from "@/components/UserSettings";
import UserWishlist from "@/components/UserWishlist";
import { Button } from "@/components/ui/button";
import ProfileTabs from "@/components/ProfileTabs";

export const metadata: Metadata = {
  title: "Profil - Health Shop Savvy",
  description: "Upravljajte svojim profilom na Health Shop Savvy platformi.",
};

export default function ProfilePage() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [activeTab, setActiveTab] = useState<"settings" | "wishlist">(
    "settings"
  );

  useEffect(() => {
    // Check if user is logged in
    const loggedIn = localStorage.getItem("isLoggedIn") === "true";
    if (!loggedIn) {
      router.push("/prijava");
      return;
    }

    setIsLoggedIn(loggedIn);
    setUserEmail(localStorage.getItem("userEmail") || "");
    setUserName(localStorage.getItem("userName") || "");
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("userEmail");
    localStorage.removeItem("userName");

    // Trigger storage event for other components
    window.dispatchEvent(new Event("storage"));

    router.push("/");
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen flex flex-col bg-health-light dark:bg-gray-900">
        <Navbar />
        <main className="flex-grow flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-600 dark:text-gray-400">Učitavanje...</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-health-light dark:bg-gray-900">
      <Navbar />

      <main className="flex-grow container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 mb-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Dobrodošli, {userName || userEmail}!
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  Upravljajte svojim profilom i pratite omiljene proizvode
                </p>
              </div>

              <Button
                onClick={handleLogout}
                variant="outline"
                className="mt-4 sm:mt-0 border-red-300 text-red-600 hover:bg-red-50 dark:border-red-600 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                Odjavite se
              </Button>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border dark:border-gray-700">
            <ProfileTabs activeTab={activeTab} setActiveTab={setActiveTab} />

            <div className="p-6">
              {activeTab === "settings" && <UserSettings />}
              {activeTab === "wishlist" && <UserWishlist />}
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
