"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import GoogleSignInButton from "@/components/GoogleSignInButton";

export const dynamic = "force-dynamic";

export default function RegistrationPage() {
  const router = useRouter();
  const { user, register, googleSignIn } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) router.push("/profil");
  }, [user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Lozinka mora imati najmanje 8 karaktera");
      return;
    }
    if (password !== confirm) {
      setError("Lozinke se ne podudaraju");
      return;
    }
    setIsLoading(true);
    try {
      await register(email, name, password);
      router.push("/profil");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Greška prilikom registracije");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogle = async (credential: string) => {
    try {
      await googleSignIn(credential);
      router.push("/profil");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google prijava nije uspela");
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-health-light dark:bg-gray-900">
      <Navbar />

      <main className="flex-grow flex items-center justify-center px-4 py-8">
        <div className="max-w-md w-full space-y-6">
          <div>
            <h2 className="mt-2 text-center text-3xl font-extrabold text-gray-900 dark:text-white">
              Registrujte se
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
              Već imate nalog?{" "}
              <Link
                href="/prijava"
                className="font-medium text-health-primary hover:text-health-secondary dark:text-health-accent"
              >
                Prijavite se
              </Link>
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/30 p-3 text-sm text-red-700 dark:text-red-300">{error}</div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <Input type="text" autoComplete="name" required placeholder="Ime i prezime" value={name} onChange={(e) => setName(e.target.value)} />
            <Input type="email" autoComplete="email" required placeholder="Email adresa" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input type="password" autoComplete="new-password" required placeholder="Lozinka (najmanje 8 karaktera)" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Input type="password" autoComplete="new-password" required placeholder="Potvrdite lozinku" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <Button type="submit" disabled={isLoading} className="w-full bg-health-primary hover:bg-health-secondary text-white">
              {isLoading ? "Registracija..." : "Registrujte se"}
            </Button>
          </form>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
            <span className="text-xs text-gray-500">ili</span>
            <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
          </div>

          <GoogleSignInButton onCredential={handleGoogle} />

          <p className="text-center text-xs text-gray-500 dark:text-gray-400">
            Registracijom prihvatate naše uslove korišćenja i politiku privatnosti.
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}
