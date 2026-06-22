"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import PharmacyCard from "@/components/PharmacyCard";
import { Input } from "@/components/ui/input";
import { vendorsApi, Pharmacy } from "@/lib/vendors";
import { Search } from "lucide-react";

export const dynamic = "force-dynamic";

export default function PharmaciesPage() {
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [city, setCity] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    vendorsApi
      .list()
      .then((v) => {
        if (!cancelled) setPharmacies(v);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cities = useMemo(() => {
    const counts = new Map<string, number>();
    pharmacies.forEach((p) => {
      if (p.city) counts.set(p.city, (counts.get(p.city) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => c);
  }, [pharmacies]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pharmacies.filter((p) => {
      if (city && p.city !== city) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.city.toLowerCase().includes(q) ||
        p.address.toLowerCase().includes(q)
      );
    });
  }, [pharmacies, query, city]);

  return (
    <div className="min-h-screen flex flex-col bg-health-light dark:bg-gray-900">
      <Navbar />
      <main className="flex-grow container mx-auto px-4 py-8">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Apoteke i prodavnice</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Kontakt podaci svih {pharmacies.length || ""} partnera — pozovite ih ili posetite direktno.
          </p>

          <div className="relative mb-4">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pretraži po imenu, gradu ili adresi..."
              className="pl-10"
            />
          </div>

          {cities.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-6">
              <button
                onClick={() => setCity("")}
                className={`text-sm px-3 py-1 rounded-full transition-colors ${
                  city === ""
                    ? "bg-health-primary text-white"
                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                Svi gradovi
              </button>
              {cities.map((c) => (
                <button
                  key={c}
                  onClick={() => setCity(c === city ? "" : c)}
                  className={`text-sm px-3 py-1 rounded-full transition-colors ${
                    city === c
                      ? "bg-health-primary text-white"
                      : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <p className="text-center text-gray-500 dark:text-gray-400 py-12">Učitavanje...</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-gray-500 dark:text-gray-400 py-12">Nema rezultata.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((p) => (
                <PharmacyCard key={p.id} pharmacy={p} />
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
