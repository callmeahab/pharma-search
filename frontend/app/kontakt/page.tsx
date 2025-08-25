"use client";
import React, { useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Mail, MapPin } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export const dynamic = 'force-dynamic';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export default function ContactPage() {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !message) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message }),
      });
      if (!res.ok) throw new Error("Request failed");
      toast({ title: "Poruka je poslata", description: "Javićemo Vam se uskoro." });
      setName("");
      setEmail("");
      setMessage("");
    } catch (err) {
      toast({ title: "Greška", description: "Pokušajte ponovo.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Navbar />
      <main className="container mx-auto px-4 py-12 flex-grow min-h-[calc(100vh-400px)]">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl md:text-4xl font-bold text-health-secondary dark:text-health-accent mb-8">
            Kontaktirajte nas
          </h1>

          <div className="mb-10 bg-gray-50 dark:bg-gray-800 p-6 rounded-lg">
            <h2 className="text-2xl font-semibold text-health-secondary dark:text-health-accent mb-4">
              Podrška je naša glavna prioritet
            </h2>
            <p className="mb-4 text-gray-700 dark:text-gray-300">
              Mi smo oduševljeni što gradimo pažljivo osmišljene proizvode koji
              poboljšavaju tvoj workflow. U Pharmagician-u znamo da kvalitetna
              podrška čini razliku, zato smo posvećeni stvaranju rešenja koja ne
              samo da olakšavaju pretragu i poređenje zdravstvenih proizvoda,
              već i omogućavaju besprekornu integraciju i brz razvoj novih
              funkcionalnosti.
            </p>
            <p className="mb-4 text-gray-700 dark:text-gray-300">
              Naša platforma koristi moderne tehnologije – razvili smo reusable
              React komponente i implementirali modernu mono repo arhitekturu,
              što ti omogućava da lako kreiraš i deploy-uješ više aplikacija sa
              zajedničkim kodom. Uz potpunu Firebase integraciju, naš sistem je
              optimizovan za brz deploy i pouzdan rad.
            </p>
            <p className="mb-4 text-gray-700 dark:text-gray-300">
              Ako imaš pitanja, potrebu za podrškom ili želiš da saznaš više o
              našim tehnološkim rešenjima, slobodno nas kontaktiraj. Tu smo da
              ti pomognemo da maksimalno iskoristiš mogućnosti koje Pharmagician
              pruža!
            </p>
            <p className="text-gray-700 dark:text-gray-300">
              Kontaktiraj nas danas – zajedno gradimo budućnost koja čini
              zdravlje pristupačnijim i informisanijim.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label
                    htmlFor="name"
                    className="block text-sm font-medium mb-2 dark:text-gray-200"
                  >
                    Ime i prezime
                  </label>
                  <Input
                    id="name"
                    placeholder="Unesite vaše ime i prezime"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium mb-2 dark:text-gray-200"
                  >
                    Email adresa
                  </label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="vas@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="message"
                    className="block text-sm font-medium mb-2 dark:text-gray-200"
                  >
                    Poruka
                  </label>
                  <Textarea
                    id="message"
                    placeholder="Kako Vam možemo pomoći?"
                    className="min-h-[150px]"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    required
                  />
                </div>

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Slanje..." : "Pošalji poruku"}
                </Button>
              </form>
            </div>

            <div className="bg-health-light dark:bg-gray-700 p-6 rounded-lg">
              <h2 className="text-xl font-semibold mb-6 text-health-secondary dark:text-health-accent">
                Kontakt informacije
              </h2>

              <div className="space-y-4">
                <div className="flex items-start">
                  <Mail className="w-5 h-5 text-health-primary dark:text-health-accent mr-3 mt-0.5" />
                  <div>
                    <p className="font-medium dark:text-gray-200">Email</p>
                    <a
                      href="mailto:apostekafm@gmail.com"
                      className="text-gray-600 dark:text-gray-300 hover:text-health-primary dark:hover:text-health-accent"
                    >
                      apostekafm@gmail.com
                    </a>
                  </div>
                </div>

                <div className="flex items-start">
                  <MapPin className="w-5 h-5 text-health-primary dark:text-health-accent mr-3 mt-0.5" />
                  <div>
                    <p className="font-medium dark:text-gray-200">Adresa</p>
                    <p className="text-gray-600 dark:text-gray-300">
                      WEB
                      <br />
                      11000 Beograd
                      <br />
                      Srbija
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
