import { Metadata } from "next";
import React from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "O nama - Apošteka",
  description:
    "Saznajte više o Apošteka platformi za poređenje cena zdravstvenih proizvoda.",
};

export default function AboutUsPage() {
  return (
    <>
      <Navbar />
      <main className="container mx-auto px-4 py-12 flex-grow min-h-[calc(100vh-400px)]">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl md:text-4xl font-bold text-health-secondary dark:text-health-accent mb-8">
            Apošteka – Vaš Digitalni Vodič za Zdravlje
          </h1>

          <div className="prose dark:prose-invert max-w-none">
            <p className="text-lg mb-6">
              Apošteka je jedinstvena platforma koja vam omogućava da na jednom
              mestu pregledate i uporedite cene lekova, suplemenata, medicinske
              opreme, sportskih dodataka, vitamina i drugih zdravstvenih
              proizvoda iz svih apoteka. Naš cilj je da demokratizujemo pristup
              ovim proizvodima, čineći ih dostupnijim i transparentnijim za sve
              korisnike.
            </p>

            <h2 className="text-2xl font-semibold text-health-primary dark:text-health-light mt-8 mb-4">
              Naša Misija i Vizija
            </h2>
            <p className="mb-4">
              Naša misija je jasna: želimo da osiguramo da svaka osoba ima
              pristup najnovijim i najpovoljnijim zdravstvenim proizvodima. Kroz
              Apošteku, omogućavamo vam da brzo pronađete, uporedite i odaberete
              proizvode koji najbolje odgovaraju vašim potrebama – sve to iz
              udobnosti vašeg doma.
            </p>
            <p className="mb-4">
              Naša vizija je da postanemo lider u digitalnom pristupu
              zdravstvenim proizvodima, stvarajući most između tradicionalnih
              apoteka i modernih tehnologija. Verujemo da informisanost i
              transparentnost direktno utiču na zdravlje i dobrobit svakog
              pojedinca, te nastojimo da:
            </p>
            <ul className="list-disc pl-6 mb-6">
              <li>Omogućimo jednostavan i brz pristup kvalitetnoj ponudi.</li>
              <li>Podstaknemo svest o važnosti preventivne nege.</li>
              <li>Kreiramo zajednicu gde korisnici dele iskustva i savete.</li>
            </ul>

            <h2 className="text-2xl font-semibold text-health-primary dark:text-health-light mt-8 mb-4">
              Šta Nas Izdvaja?
            </h2>
            <p className="mb-2">
              <span className="font-semibold">Sveobuhvatnost Ponude:</span> Naša
              baza podataka redovno se ažurira i obuhvata proizvode iz svih
              apoteka u regionu, tako da uvek imate pristup najnovijim
              informacijama.
            </p>
            <p className="mb-2">
              <span className="font-semibold">
                Praktičnost i Ušteda Vremena:
              </span>{" "}
              Intuitivan dizajn aplikacije omogućava jednostavno pretraživanje,
              filtriranje i poređenje proizvoda, čime štedite dragoceno vreme.
            </p>
            <p className="mb-2">
              <span className="font-semibold">
                Transparentnost i Pouzdanost:
              </span>{" "}
              Svaki proizvod je detaljno opisan – od cene, dostupnosti, preko
              recenzija, do specifičnih karakteristika – kako biste mogli
              donositi potpuno informisane odluke.
            </p>
            <p className="mb-6">
              <span className="font-semibold">Inovativnost:</span> Naš tim
              stalno prati trendove u farmaciji i tehnologiji, uvodeći nove
              funkcionalnosti koje poboljšavaju vaše korisničko iskustvo.
            </p>

            <h2 className="text-2xl font-semibold text-health-primary dark:text-health-light mt-8 mb-4">
              Naš Tim i Naša Stručnost
            </h2>
            <p className="mb-6">
              Apošteka okuplja tim stručnjaka iz oblasti farmacije, IT
              tehnologije, dizajna i korisničkog iskustva. Naš tim je posvećen
              kontinuiranom unapređenju platforme, sa ciljem da vam pruži
              najpreciznije i najpouzdanije informacije. Kroz dugogodišnje
              iskustvo i inovativan pristup, naš tim je tu da odgovori na sve
              vaše potrebe i pitanja.
            </p>

            <h2 className="text-2xl font-semibold text-health-primary dark:text-health-light mt-8 mb-4">
              Naše Vrednosti
            </h2>
            <p className="mb-2">
              <span className="font-semibold">Integritet:</span> Postupamo sa
              najvišim etičkim standardima i obezbeđujemo tačne informacije,
              kako bi vaša odluka o kupovini bila uvek zasnovana na realnim
              podacima.
            </p>
            <p className="mb-2">
              <span className="font-semibold">
                Korisnički Centriran Pristup:
              </span>{" "}
              Vaše zadovoljstvo nam je najvažnije. Slušamo vaše povratne
              informacije i stalno radimo na unapređenju usluga.
            </p>
            <p className="mb-2">
              <span className="font-semibold">Inovativnost:</span> Konstantno
              uvodimo nove tehnologije i unapređujemo funkcionalnosti platforme
              kako bismo vam omogućili najmoderniji pristup zdravstvenim
              proizvodima.
            </p>
            <p className="mb-6">
              <span className="font-semibold">Dostupnost:</span> Cilj nam je da
              svi korisnici – bez obzira na njihove potrebe – imaju jednostavan
              pristup ključnim informacijama i najpovoljnijim ponudama.
            </p>

            <h2 className="text-2xl font-semibold text-health-primary dark:text-health-light mt-8 mb-4">
              Zašto Izabrati Apošteku?
            </h2>
            <p className="mb-2">
              <span className="font-semibold">Jednostavnost Upotrebe:</span> Naš
              intuitivan interfejs čini pretragu proizvoda brzim i jednostavnim,
              čak i za one koji nisu tehnološki potkovani.
            </p>
            <p className="mb-2">
              <span className="font-semibold">Sveobuhvatna Informacija:</span>{" "}
              Pored cena, dobijate detaljne opise, recenzije i podatke o
              dostupnosti, što vam pomaže da donosite najbolje odluke za svoje
              zdravlje.
            </p>
            <p className="mb-2">
              <span className="font-semibold">Neprekidno Unapređenje:</span>{" "}
              Naša platforma se redovno ažurira i prilagođava potrebama
              korisnika, kako bi uvek bila relevantna i korisna.
            </p>
            <p className="mb-6">
              <span className="font-semibold">Podrška Korisnicima:</span> Naš
              tim za podršku uvek je spreman da odgovori na vaša pitanja i pruži
              potrebne informacije – jer vaše zadovoljstvo je naš prioritet.
            </p>

            <h2 className="text-2xl font-semibold text-health-primary dark:text-health-light mt-8 mb-4">
              Naša Posvećenost Zdravlju i Dobrobiti
            </h2>
            <p className="mb-6">
              Verujemo da zdravlje ne treba da bude luksuz. Apošteka vam pruža
              alate za brzo i precizno poređenje proizvoda, omogućavajući vam da
              na jednostavan način pronađete najbolje opcije. Naš cilj je da
              doprinesemo boljem zdravstvenom sistemu i pomognemo vam da brinete
              o svom zdravlju na najefikasniji mogući način.
            </p>

            <h2 className="text-2xl font-semibold text-health-primary dark:text-health-light mt-8 mb-4">
              Hvala Vam
            </h2>
            <p className="mb-6">
              Hvala što ste odabrali Apošteku. Vaše poverenje je naša najveća
              motivacija za kontinuirani rad i inovacije. Pozivamo vas da
              istražite sve mogućnosti koje vam pružamo i da nam se obratite sa
              svojim pitanjima i sugestijama.
            </p>

            <p className="mb-6 font-semibold text-center italic">
              U Apošteci verujemo da je informacija moć – neka vaše zdravlje
              bude u vašim rukama!
            </p>

            <div className="mt-12 border-t pt-6 text-sm">
              <p className="mb-2">
                Za medijske upite, kontaktirajte nas na:{" "}
                <a
                  href="mailto:apostekafm@gmail.com"
                  className="text-health-primary dark:text-health-accent hover:underline"
                >
                  apostekafm@gmail.com
                </a>
              </p>
              <p>
                Za ostala pitanja, posetite našu{" "}
                <a
                  href="/kontakt"
                  className="text-health-primary dark:text-health-accent hover:underline"
                >
                  Kontaktirajte nas
                </a>{" "}
                stranicu.
              </p>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
