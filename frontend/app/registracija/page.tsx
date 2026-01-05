"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Link from "next/link";

export const dynamic = 'force-dynamic';

export default function RegistrationPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Check if user is already logged in
    const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    if (isLoggedIn) {
      router.push("/profil");
    }
  }, [router]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Basic validation
      if (formData.password !== formData.confirmPassword) {
        alert("Lozinke se ne poklapaju");
        return;
      }

      if (formData.password.length < 6) {
        alert("Lozinka mora imati najmanje 6 karaktera");
        return;
      }

      // Simulate registration process
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // For demo purposes, auto-login after registration
      localStorage.setItem("isLoggedIn", "true");
      localStorage.setItem("userEmail", formData.email);
      localStorage.setItem("userName", formData.name);

      // Trigger storage event for other components
      window.dispatchEvent(new Event("storage"));

      router.push("/profil");
    } catch (error) {
      console.error("Registration error:", error);
      alert("Greška prilikom registracije");
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
              Registrujte se
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
              Ili{" "}
              <Link
                href="/prijava"
                className="font-medium text-health-primary hover:text-health-secondary dark:text-health-accent"
              >
                prijavite se ovde
              </Link>
            </p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div>
                <label htmlFor="name" className="sr-only">
                  Ime i prezime
                </label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  required
                  placeholder="Ime i prezime"
                  value={formData.name}
                  onChange={handleInputChange}
                />
              </div>

              <div>
                <label htmlFor="email" className="sr-only">
                  Email adresa
                </label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="Email adresa"
                  value={formData.email}
                  onChange={handleInputChange}
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
                  autoComplete="new-password"
                  required
                  placeholder="Lozinka (najmanje 6 karaktera)"
                  value={formData.password}
                  onChange={handleInputChange}
                />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="sr-only">
                  Potvrdite lozinku
                </label>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  placeholder="Potvrdite lozinku"
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                />
              </div>
            </div>

            <div>
              <Button
                type="submit"
                className="w-full bg-health-primary hover:bg-health-secondary text-white"
                disabled={isLoading}
              >
                {isLoading ? "Registracija..." : "Registrujte se"}
              </Button>
            </div>
          </form>
        </div>
      </main>

      <Footer />
    </div>
  );
}
