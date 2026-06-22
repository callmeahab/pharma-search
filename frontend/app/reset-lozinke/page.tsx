"use client";

import React, { useState, useEffect, Suspense } from "react";
import { Mail, KeyRound } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}

function ResetPasswordInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { requestPasswordReset, confirmPasswordReset } = useAuth();

  const token = params.get("token");
  const step: "email" | "verify" = token ? "verify" : "email";

  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Avoid the unused-import lint until we wire icons everywhere
  useEffect(() => {}, []);

  const onEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
      toast({
        title: "Proverite email",
        description: "Ako nalog postoji, poslali smo link za resetovanje lozinke.",
      });
    } catch {
      // Don't leak whether the email exists.
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  const onResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError("Lozinka mora imati najmanje 8 karaktera");
      return;
    }
    if (newPassword !== confirm) {
      setError("Lozinke se ne podudaraju");
      return;
    }
    setLoading(true);
    try {
      await confirmPasswordReset(token as string, newPassword);
      toast({
        title: "Lozinka uspešno resetovana",
        description: "Možete se prijaviti sa vašom novom lozinkom.",
      });
      setTimeout(() => router.push("/prijava"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Link nije važeći ili je istekao");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 py-12 dark:bg-gray-900 transition-colors duration-200">
        <div className="container mx-auto px-4">
          <div className="max-w-md mx-auto bg-white rounded-lg shadow-md overflow-hidden dark:bg-gray-800 transition-colors duration-200">
            <div className="p-8">
              <h2 className="text-2xl font-bold text-center mb-6 text-health-primary dark:text-health-accent">
                {step === "email" ? "Resetovanje lozinke" : "Nova lozinka"}
              </h2>

              {error && (
                <div className="mb-4 rounded-md bg-red-50 dark:bg-red-900/30 p-3 text-sm text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              {step === "email" ? (
                sent ? (
                  <div className="text-center space-y-4">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Ako za <strong>{email}</strong> postoji nalog, poslali smo link za
                      resetovanje lozinke. Proverite vaše poštansko sanduče.
                    </p>
                    <Link
                      href="/prijava"
                      className="inline-block text-sm text-health-primary hover:underline dark:text-health-accent"
                    >
                      Nazad na prijavu
                    </Link>
                  </div>
                ) : (
                  <form onSubmit={onEmailSubmit} className="space-y-6">
                    <div>
                      <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                        Email adresa
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400">
                          <Mail size={18} />
                        </div>
                        <Input
                          type="email"
                          required
                          placeholder="vasa.adresa@email.com"
                          className="pl-10"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                      </div>
                    </div>
                    <Button
                      type="submit"
                      disabled={loading}
                      className="w-full bg-health-primary hover:bg-health-secondary transition-colors duration-200 dark:bg-health-secondary dark:hover:bg-health-primary"
                    >
                      {loading ? "Slanje..." : "Pošalji link za resetovanje"}
                    </Button>
                    <div className="text-center">
                      <Link
                        href="/prijava"
                        className="text-sm text-health-primary hover:underline dark:text-health-accent"
                      >
                        Nazad na prijavu
                      </Link>
                    </div>
                  </form>
                )
              ) : (
                <form onSubmit={onResetSubmit} className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                      Nova lozinka
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400">
                        <KeyRound size={18} />
                      </div>
                      <Input
                        type="password"
                        required
                        placeholder="Najmanje 8 karaktera"
                        className="pl-10"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                      Potvrdite novu lozinku
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400">
                        <KeyRound size={18} />
                      </div>
                      <Input
                        type="password"
                        required
                        placeholder="Ponovite lozinku"
                        className="pl-10"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                      />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-health-primary hover:bg-health-secondary transition-colors duration-200 dark:bg-health-secondary dark:hover:bg-health-primary"
                  >
                    {loading ? "Čuvanje..." : "Sačuvaj novu lozinku"}
                  </Button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}
