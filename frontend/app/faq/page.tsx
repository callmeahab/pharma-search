import { Metadata } from "next";
import React from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const metadata: Metadata = {
  title: "FAQ - Apošteka",
  description: "Često postavljana pitanja o Apošteka platformi.",
};

export default function FAQPage() {
  const faqItems = [
    {
      question: "Šta je Apošteka?",
      answer:
        "Apošteka je jedinstvena platforma koja omogućava pregled i poređenje cena lekova, suplemenata, medicinske opreme, sportskih dodataka, vitamina i drugih zdravstvenih proizvoda, dostupnih kako u apotekama, tako i u fitnes prodavnicama – sve na jednom mestu.",
    },
    {
      question: "Kako funkcioniše aplikacija?",
      answer:
        "Kroz intuitivan interfejs, korisnici mogu lako pretraživati proizvode, upoređivati cene i dostupnost iz više apoteka. Podaci se redovno ažuriraju, tako da uvek imate pristup najtačnijim informacijama.",
    },
    {
      question: "Da li je Apošteka besplatan za korišćenje?",
      answer:
        "Da, naša platforma je potpuno besplatna. Korisnici mogu pretraživati i upoređivati proizvode bez ikakvih dodatnih troškova.",
    },
    {
      question: "Kako se ažuriraju cene i podaci o proizvodima?",
      answer:
        "Podaci se prikupljaju iz svih apoteka, a naš tim ih redovno osvežava kako bi osigurao tačnost i pouzdanost informacija. Ažuriranja se dešavaju dva puta dnevno, što vam omogućava da uvek budete informisani.",
    },
    {
      question: "Da li mogu kupovati proizvode direktno preko platforme?",
      answer:
        "Apošteka je informativna platforma koja vam pomaže da pronađete najbolje ponude. Kupovina se obavlja direktno u apotekama ili preko partnera s kojima sarađujemo.",
    },
    {
      question: "Kako mogu da kontaktiram tim za podršku?",
      answer:
        'Ako imate pitanja ili vam je potrebna pomoć, možete nas kontaktirati putem stranice "Kontaktiraj nas" ili poslati email na press@borobazar.com. Naš tim je uvek spreman da vam pomogne.',
    },
    {
      question: "Da li su moji lični podaci sigurni?",
      answer:
        "Apsolutno – zaštita vaših podataka nam je prioritet. Koristimo najnovije tehnologije za sigurnost podataka i pridržavamo se svih relevantnih propisa.",
    },
    {
      question: "Da li postoji mobilna aplikacija?",
      answer:
        "Trenutno je Apošteka dostupna kao web platforma. Međutim, u planu je razvoj mobilne aplikacije kako bi pristup bio još jednostavniji sa svih uređaja.",
    },
    {
      question: "Kako mogu da doprinesem poboljšanju platforme?",
      answer:
        'Vaše povratne informacije su nam dragocene! Možete nam poslati svoje sugestije putem stranice "Kontaktiraj nas" ili direktno na naš email. Cenimo svaki komentar koji doprinosi našem stalnom unapređenju.',
    },
    {
      question: "Koji su benefiti korišćenja Apošteka-a?",
      answer:
        "Ušteda vremena i novca: Brzo pretraživanje ponuda iz više apoteka omogućava pronalaženje najboljih cena, čime se štedi i vreme i novac. Potpuna transparentnost: Detaljni opisi proizvoda i redovno ažurirane cene pomažu vam da donesete informisane odluke. Jednostavnost korišćenja: Moderan i intuitivan dizajn aplikacije omogućava jednostavnu navigaciju prilagođenu svim korisnicima. Inovativnost: Primena najnovijih tehnologija garantuje pouzdane informacije i stalno unapređenje funkcionalnosti, držeći vas u toku sa najnovijim trendovima.",
    },
  ];

  return (
    <>
      <Navbar />
      <main className="container mx-auto px-4 py-12 flex-grow min-h-[calc(100vh-400px)]">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl md:text-4xl font-bold text-health-secondary dark:text-health-accent mb-8">
            Najčešće postavljana pitanja
          </h1>

          <p className="text-lg mb-8">
            Pronađite odgovore na najčešće postavljana pitanja o korišćenju
            Apošteka platforme.
          </p>

          <Accordion type="single" collapsible className="w-full">
            {faqItems.map((item, index) => (
              <AccordionItem key={index} value={`item-${index}`}>
                <AccordionTrigger className="text-left text-lg font-medium">
                  {item.question}
                </AccordionTrigger>
                <AccordionContent className="text-gray-700 dark:text-gray-300">
                  {item.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          <div className="mt-12 p-6 bg-health-light dark:bg-gray-700 rounded-lg">
            <h2 className="text-xl font-semibold mb-4 text-health-secondary dark:text-health-accent">
              Još uvek imate pitanja?
            </h2>
            <p className="mb-4 dark:text-gray-200">
              Ako ne možete pronaći odgovor na svoje pitanje, slobodno nas
              kontaktirajte i rado ćemo vam pomoći.
            </p>
            <a
              href="/kontakt"
              className="inline-block bg-health-primary hover:bg-health-secondary text-white font-medium py-2 px-6 rounded-md transition-colors duration-200"
            >
              Kontaktirajte nas
            </a>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
