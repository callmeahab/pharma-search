"use client";

import React, { useState, useEffect, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter, useSearchParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import { toast } from "@/hooks/use-toast";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, login, googleSignIn, requestMagicLink, consumeMagicToken } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [magicSent, setMagicSent] = useState(false);

  // Magic-link landing: /prijava?token=...
  useEffect(() => {
    const token = params.get("token");
    if (!token) return;
    (async () => {
      try {
        await consumeMagicToken(token);
        router.push("/profil");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Link nije važeći");
      }
    })();
  }, [params, consumeMagicToken, router]);

  useEffect(() => {
    if (user) router.push("/profil");
  }, [user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      await login(email, password);
      router.push("/profil");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Greška prilikom prijave");
    } finally {
      setIsLoading(false);
    }
  };

  const handleMagic = async () => {
    if (!email) {
      setError("Unesite email adresu za magic link");
      return;
    }
    try {
      await requestMagicLink(email);
      setMagicSent(true);
      toast({ title: "Proverite email", description: "Poslali smo vam link za prijavu." });
    } catch {
      toast({ title: "Greška", description: "Nije moguće poslati link." });
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
              Prijavite se na svoj nalog
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
              Ili{" "}
              <Link href="/registracija" className="font-medium text-health-primary hover:text-health-secondary dark:text-health-accent">
                registrujte se ovde
              </Link>
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/30 p-3 text-sm text-red-700 dark:text-red-300">{error}</div>
          )}
          {magicSent && (
            <div className="rounded-md bg-green-50 dark:bg-green-900/30 p-3 text-sm text-green-700 dark:text-green-300">
              Link za prijavu je poslat na {email}.
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <Input type="email" autoComplete="email" required placeholder="Email adresa" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input type="password" autoComplete="current-password" required placeholder="Lozinka" value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="flex justify-end">
              <Link href="/reset-lozinke" className="text-sm text-health-primary hover:text-health-secondary dark:text-health-accent">
                Zaboravili ste lozinku?
              </Link>
            </div>
            <Button type="submit" disabled={isLoading} className="w-full bg-health-primary hover:bg-health-secondary text-white">
              {isLoading ? "Prijavljivanje..." : "Prijavi se"}
            </Button>
          </form>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
            <span className="text-xs text-gray-500">ili</span>
            <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
          </div>

          <Button type="button" variant="outline" onClick={handleMagic} className="w-full">
            Pošalji mi link za prijavu (bez lozinke)
          </Button>

          <GoogleSignInButton onCredential={handleGoogle} />
        </div>
      </main>
      <Footer />
    </div>
  );
}
