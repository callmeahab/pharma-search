"use client";

import { Metadata } from "next";
import React from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Mail, Phone, MapPin } from "lucide-react";

export default function ContactPage() {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Handle form submission logic here
    console.log("Kontakt forma poslata");
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
                    placeholder="Kako vam možemo pomoći?"
                    className="min-h-[150px]"
                    required
                  />
                </div>

                <Button type="submit" className="w-full">
                  Pošalji poruku
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
                      href="mailto:info@aposteka.com"
                      className="text-gray-600 dark:text-gray-300 hover:text-health-primary dark:hover:text-health-accent"
                    >
                      info@aposteka.com
                    </a>
                  </div>
                </div>

                <div className="flex items-start">
                  <Phone className="w-5 h-5 text-health-primary dark:text-health-accent mr-3 mt-0.5" />
                  <div>
                    <p className="font-medium dark:text-gray-200">Telefon</p>
                    <a
                      href="tel:+38112345678"
                      className="text-gray-600 dark:text-gray-300 hover:text-health-primary dark:hover:text-health-accent"
                    >
                      +381 1 234 5678
                    </a>
                  </div>
                </div>

                <div className="flex items-start">
                  <MapPin className="w-5 h-5 text-health-primary dark:text-health-accent mr-3 mt-0.5" />
                  <div>
                    <p className="font-medium dark:text-gray-200">Adresa</p>
                    <p className="text-gray-600 dark:text-gray-300">
                      Knez Mihailova 22
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
