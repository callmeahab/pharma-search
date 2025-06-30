import React from "react";
import { Instagram, Facebook, Share2 } from "lucide-react";
import Link from "next/link";
import { Copyright } from "lucide-react";

const Footer = () => {
  return (
    <footer className="bg-white border-t border-gray-200 py-8 dark:bg-gray-800 dark:border-gray-700 transition-colors duration-200">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <h3 className="font-bold text-xl mb-4">
              <span className="text-green-400 dark:text-green-300">Apo</span>
              <span className="text-green-600 dark:text-green-600">šteka</span>
            </h3>
            <p className="text-gray-600 text-sm dark:text-gray-400">
              Uporedite cene u različitim apotekama i pronađite najbolje ponude
              za zdravstvene proizvode.
            </p>
          </div>

          <div>
            <h4 className="font-semibold mb-4 dark:text-gray-200">O nama</h4>
            <ul className="space-y-2 text-gray-600 dark:text-gray-400">
              <li>
                <Link
                  href="/o-nama"
                  className="hover:text-health-primary dark:hover:text-health-accent"
                >
                  O nama
                </Link>
              </li>
              <li>
                <Link
                  href="/kontakt"
                  className="hover:text-health-primary dark:hover:text-health-accent"
                >
                  Kontaktiraj nas
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4 dark:text-gray-200">
              Naše informacije
            </h4>
            <ul className="space-y-2 text-gray-600 dark:text-gray-400">
              <li>
                <Link
                  href="/privatnost"
                  className="hover:text-health-primary dark:hover:text-health-accent"
                >
                  Politika privatnosti
                </Link>
              </li>
              <li>
                <Link
                  href="/faq"
                  className="hover:text-health-primary dark:hover:text-health-accent"
                >
                  Najčešće postavljana pitanja
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4 dark:text-gray-200">
              Pratite nas
            </h4>
            <div className="flex space-x-4">
              <a
                href="https://instagram.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-600 hover:text-health-primary dark:text-gray-400 dark:hover:text-health-accent"
              >
                <Instagram size={24} />
                <span className="sr-only">Instagram</span>
              </a>
              <a
                href="https://facebook.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-600 hover:text-health-primary dark:text-gray-400 dark:hover:text-health-accent"
              >
                <Facebook size={24} />
                <span className="sr-only">Facebook</span>
              </a>
              <a
                href="https://tiktok.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-600 hover:text-health-primary dark:text-gray-400 dark:hover:text-health-accent"
              >
                <Share2 size={24} />
                <span className="sr-only">TikTok</span>
              </a>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 mt-8 pt-6 text-center text-gray-500 dark:text-gray-400 text-sm dark:border-gray-700">
          <p className="flex items-center justify-center gap-1">
            <Copyright size={16} /> Copyright {new Date().getFullYear()}{" "}
            Apošteka. Sva prava zadržana.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
