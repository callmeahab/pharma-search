import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "404 - Stranica nije pronađena | Health Shop Savvy",
  description: "Stranica koju tražite nije pronađena.",
};

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-health-light dark:bg-gray-900">
      <div className="text-center px-4">
        <div className="mb-8">
          <h1 className="text-9xl font-bold text-health-primary dark:text-health-accent mb-4">
            404
          </h1>
          <h2 className="text-3xl font-semibold text-gray-800 dark:text-gray-100 mb-4">
            Oops! Stranica nije pronađena
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400 mb-8 max-w-md mx-auto">
            Izvinjavamo se, ali stranica koju tražite ne postoji ili je možda
            premešena.
          </p>
        </div>

        <div className="space-y-4">
          <Link
            href="/"
            className="inline-block bg-health-primary hover:bg-health-secondary text-white font-semibold py-3 px-8 rounded-lg transition-colors duration-200"
          >
            Povratak na početnu
          </Link>

          <div className="text-sm text-gray-500 dark:text-gray-400">
            <p>Ili možete da:</p>
            <div className="mt-2 space-x-4">
              <Link
                href="/o-nama"
                className="text-health-primary hover:text-health-secondary underline"
              >
                Saznajte više o nama
              </Link>
              <Link
                href="/kontakt"
                className="text-health-primary hover:text-health-secondary underline"
              >
                Kontaktirajte nas
              </Link>
              <Link
                href="/faq"
                className="text-health-primary hover:text-health-secondary underline"
              >
                Pogledajte FAQ
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
