"use client";

import { Metadata } from "next";
import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Check if user is already logged in
    const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    if (isLoggedIn) {
      router.push("/profil");
    }
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Simulate login process
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // For demo purposes, accept any email/password
      if (email && password) {
        localStorage.setItem("isLoggedIn", "true");
        localStorage.setItem("userEmail", email);

        // Trigger storage event for other components
        window.dispatchEvent(new Event("storage"));

        router.push("/profil");
      } else {
        alert("Molimo unesite email i lozinku");
      }
    } catch (error) {
      console.error("Login error:", error);
      alert("Greška prilikom prijavljivanja");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-health-light dark:bg-gray-900">
      <Navbar />

      <main className="flex-grow flex items-center justify-center px-4 py-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-white">
              Prijavite se na svoj nalog
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
              Ili{" "}
              <Link
                href="/registracija"
                className="font-medium text-health-primary hover:text-health-secondary dark:text-health-accent"
              >
                registrujte se ovde
              </Link>
            </p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <div className="rounded-md shadow-sm -space-y-px">
              <div>
                <label htmlFor="email-address" className="sr-only">
                  Email adresa
                </label>
                <Input
                  id="email-address"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="rounded-t-md"
                  placeholder="Email adresa"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="password" className="sr-only">
                  Lozinka
                </label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="rounded-b-md"
                  placeholder="Lozinka"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="text-sm">
                <Link
                  href="/reset-lozinke"
                  className="font-medium text-health-primary hover:text-health-secondary dark:text-health-accent"
                >
                  Zaboravili ste lozinku?
                </Link>
              </div>
            </div>

            <div>
              <Button
                type="submit"
                className="w-full bg-health-primary hover:bg-health-secondary text-white"
                disabled={isLoading}
              >
                {isLoading ? "Prijavljivanje..." : "Prijavite se"}
              </Button>
            </div>
          </form>
        </div>
      </main>

      <Footer />
    </div>
  );
}
