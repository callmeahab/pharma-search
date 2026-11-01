import { Metadata } from "next";
import React from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Privatnost - Apošteka",
  description: "Politika privatnosti za Apošteka platformu.",
};

export default function PrivacyPage() {
  return (
    <>
      <Navbar />
      <main className="container mx-auto px-4 py-12 flex-grow min-h-[calc(100vh-400px)]">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl md:text-4xl font-bold text-health-secondary dark:text-health-accent mb-8">
            Politika privatnosti
          </h1>

          <div className="prose dark:prose-invert max-w-none space-y-6">
            <h2 className="text-2xl font-semibold text-health-primary dark:text-health-light mt-8 mb-4">
              Dobrodošli u Apošteka
            </h2>
            <p>
              Vaša privatnost nam je važna, a naš cilj je da osiguramo da su
              vaši podaci bezbedni i da se koriste isključivo u skladu sa
              zakonskim regulativama i ovom Politikom privatnosti. Ova stranica objašnjava koje podatke obrađujemo i kako možete promeniti svoj izbor. Analitika je opciona.
            </p>

            <h2 className="text-2xl font-semibold text-health-primary dark:text-health-light mt-8 mb-4">
              Prikupljanje podataka
            </h2>
            <p>
              Prikupljamo samo one informacije koje su neophodne za pravilno
              funkcionisanje aplikacije, uključujući:
            </p>
            <ul className="list-disc pl-6 space-y-2 my-4">
              <li>
                Osnovne podatke za kreiranje naloga (ime, email adresa,
                lozinka).
              </li>
              <li>
                Samo uz prihvatanje analitike: broj rezultata, trajanje pretrage, broj filtera i poziciju kliknute ponude. Tekst pretrage, nazive proizvoda i linkove prodavaca ne šaljemo u analitičke događaje.
              </li>
            </ul>
            <p>
              Podatke naloga i praćenih proizvoda obrađujemo da bismo pružili funkcije koje ste izabrali. Tehnički zahtevi za pretragu sadrže upit potreban serveru da vrati rezultate. Tehnički dnevnici servera mogu sadržati podatke o zahtevima. Analitičke događaje šaljemo samo nakon vašeg izbora „Prihvati analitiku“. Izbor „Samo neophodno“ omogućava korišćenje pretrage bez analitike.
            </p>

            <h2 className="text-2xl font-semibold text-health-primary dark:text-health-light mt-8 mb-4">
              Korišćenje podataka
            </h2>
            <p>Vaši podaci se koriste u svrhe kao što su:</p>
            <ul className="list-disc pl-6 space-y-2 my-4">
              <li>
                Omogućavanje korišćenja aplikacije i njenih funkcionalnosti.
              </li>
              <li>
                Poboljšanje korisničkog iskustva putem analize korišćenja
                aplikacije.
              </li>
              <li>
                Prikaz praćenih proizvoda i obaveštenja o njihovim cenama, kada uključite tu funkciju.
              </li>
            </ul>
            <p>
              Nikada ne koristimo vaše podatke za svrhe koje nisu jasno
              definisane u ovoj politici.
            </p>

            <h2 className="text-2xl font-semibold text-health-primary dark:text-health-light mt-8 mb-4">
              Deljenje podataka
            </h2>
            <p>
              Ne delimo vaše podatke sa trećim stranama osim u sledećim
              situacijama:
            </p>
            <ul className="list-disc pl-6 space-y-2 my-4">
              <li>Kada je to zakonom obavezno.</li>
              <li>Opcionu analitiku prikuplja samo naš server kao ograničene događaje bez teksta upita, naziva proizvoda i linkova. Ova verzija aplikacije ne učitava Google Analytics.</li>
              <li>
                Kada je neophodno za tehničku podršku aplikacije, pri čemu se
                osigurava da treća strana poštuje odgovarajuće mere zaštite
                podataka.
              </li>
            </ul>

            <h2 className="text-2xl font-semibold text-health-primary dark:text-health-light mt-8 mb-4">
              Bezbednost podataka
            </h2>
            <p>
              Implementirali smo tehničke i organizacione mere kako bismo
              osigurali bezbednost vaših podataka. Uprkos tome, ne možemo
              garantovati apsolutnu sigurnost prilikom prenosa ili skladištenja
              podataka. Korišćenjem aplikacije prihvatate potencijalne rizike.
            </p>

            <h2 className="text-2xl font-semibold text-health-primary dark:text-health-light mt-8 mb-4">
              Odgovornost korisnika
            </h2>
            <p>
              Korisnici su odgovorni za zaštitu svojih podataka za prijavu (npr.
              lozinke) i dužni su da nas obaveste o bilo kakvom neovlašćenom
              pristupu svom nalogu.
            </p>

            <h2 className="text-2xl font-semibold text-health-primary dark:text-health-light mt-8 mb-4">
              Prava korisnika
            </h2>
            <p>Korisnici imaju pravo da:</p>
            <ul className="list-disc pl-6 space-y-2 my-4">
              <li>Pristupe, izmene ili obrišu svoje lične podatke.</li>
              <li>Promene izbor analitike u bilo kom trenutku preko dugmeta „Podešavanja kolačića“ u podnožju. Povlačenje zaustavlja dalje analitičke događaje i uklanja dostupne analitičke kolačiće ovog sajta.</li>
              <li>
                Podnesu pritužbu nadležnom organu u slučaju kršenja prava na
                privatnost.
              </li>
            </ul>

            <h2 className="text-2xl font-semibold text-health-primary dark:text-health-light mt-8 mb-4">
              Izmene politike privatnosti
            </h2>
            <p>
              Zadržavamo pravo da ažuriramo ovu Politiku privatnosti u bilo kom
              trenutku. O svim značajnim izmenama bićete obavešteni putem
              aplikacije ili emaila. Nastavak korišćenja aplikacije nakon izmena
              podrazumeva prihvatanje novih uslova.
            </p>

            <h2 className="text-2xl font-semibold text-health-primary dark:text-health-light mt-8 mb-4">
              Odricanje od odgovornosti
            </h2>
            <p>
              Iako preduzimamo sve razumne mere da osiguramo privatnost i
              bezbednost vaših podataka, Apošteka ne preuzima odgovornost u
              sledećim slučajevima:
            </p>
            <ul className="list-disc pl-6 space-y-2 my-4">
              <li>
                Neovlašćen pristup podacima: Ne snosimo odgovornost za
                neovlašćen pristup vašim podacima usled tehničkih problema,
                cyber napada ili propusta trećih strana.
              </li>
              <li>
                Korisničke greške: Ne odgovaramo za greške korisnika u vezi sa
                čuvanjem lozinki, deljenjem podataka sa drugima ili korišćenjem
                nesigurnih uređaja.
              </li>
              <li>
                Treće strane: Ne garantujemo i ne preuzimamo odgovornost za
                praksu privatnosti ili bezbednost veb stranica, aplikacija ili
                servisa trećih strana koje su povezane sa našom aplikacijom.
              </li>
              <li>
                Zakonski zahtevi: Kada se podaci dele na osnovu zakonskih
                zahteva ili sudskih naloga, Apošteka ne snosi odgovornost za
                posledice takvog deljenja.
              </li>
              <li>
                Prekid usluga: Ne preuzimamo odgovornost za eventualni gubitak
                podataka ili prekid usluga uzrokovan tehničkim problemima,
                održavanjem aplikacije ili drugim nepredviđenim okolnostima.
              </li>
              <li>
                Netipično korišćenje: Ne snosimo odgovornost za posledice
                korišćenja aplikacije na način koji nije u skladu sa njenom
                prvobitnom svrhom ili ovim uslovima korišćenja.
              </li>
              <li>
                Preciznost informacija: Trudimo se da pružamo tačne i ažurirane
                informacije, ali ne garantujemo potpune tačnost ili pouzdanost
                sadržaja u aplikaciji, uključujući opise proizvoda i cene.
              </li>
              <li>
                Zastarelost softvera: Ako koristite zastarele verzije naše
                aplikacije ili uređaje sa neadekvatnom zaštitom, ne preuzimamo
                odgovornost za eventualne posledice.
              </li>
              <li>
                Nedozvoljeno korišćenje aplikacije: Ne preuzimamo odgovornost za
                štetu izazvanu nelegalnim ili nedozvoljenim aktivnostima
                korisnika u vezi sa aplikacijom.
              </li>
              <li>
                Viša sila: Ne odgovaramo za štetu nastalu usled okolnosti više
                sile, uključujući prirodne nepogode, rat, prekide u radu mreže i
                druge događaje van naše kontrole.
              </li>
            </ul>

            <h2 className="text-2xl font-semibold text-health-primary dark:text-health-light mt-8 mb-4">
              Kontaktirajte nas
            </h2>
            <p>
              Ako imate bilo kakvih pitanja ili zahteva u vezi sa privatnošću,
              slobodno nas kontaktirajte na:
            </p>
            <p>
              📧 Email:{" "}
              <a
                href="mailto:apostekafm@gmail.com"
                className="text-health-secondary dark:text-health-accent hover:underline"
              >
                apostekafm@gmail.com
              </a>
            </p>

            <p className="mt-8">
              Vašom privatnošću upravljamo transparentno i odgovorno, jer vaše
              poverenje nam je prioritet.
            </p>

            <p className="mt-8 text-sm text-gray-600 dark:text-gray-400">
              Poslednje ažuriranje: 1. novembra 2026.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
