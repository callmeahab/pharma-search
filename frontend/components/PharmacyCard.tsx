"use client";

import { Phone, Mail, MapPin, Clock, Globe, ExternalLink } from "lucide-react";
import { Pharmacy, directionsUrl, telHref } from "@/lib/vendors";

export default function PharmacyCard({ pharmacy }: { pharmacy: Pharmacy }) {
  const p = pharmacy;
  const hasContact = p.phone || p.email || p.address;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border dark:border-gray-700 p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 dark:text-white truncate">{p.name}</h3>
          {p.city && <p className="text-sm text-gray-500 dark:text-gray-400">{p.city}</p>}
        </div>
        {p.product_count > 0 && (
          <span className="shrink-0 text-xs bg-health-light dark:bg-gray-700 text-health-primary dark:text-health-accent px-2 py-1 rounded-full">
            {p.product_count.toLocaleString("sr-RS")} proizvoda
          </span>
        )}
      </div>

      {!hasContact && (
        <p className="text-sm text-gray-400 dark:text-gray-500 italic">Kontakt podaci nisu dostupni.</p>
      )}

      <div className="space-y-2 text-sm">
        {p.address && (
          <div className="flex items-start gap-2 text-gray-700 dark:text-gray-300">
            <MapPin size={16} className="mt-0.5 shrink-0 text-gray-400" />
            <span>{p.address}</span>
          </div>
        )}
        {p.hours && (
          <div className="flex items-start gap-2 text-gray-700 dark:text-gray-300">
            <Clock size={16} className="mt-0.5 shrink-0 text-gray-400" />
            <span className="whitespace-pre-line">{p.hours}</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mt-auto pt-2">
        {p.phone && (
          <a
            href={telHref(p.phone)}
            className="inline-flex items-center gap-1.5 text-sm bg-health-primary hover:bg-health-secondary text-white px-3 py-1.5 rounded-md transition-colors"
          >
            <Phone size={14} />
            Pozovi
          </a>
        )}
        {p.email && (
          <a
            href={`mailto:${p.email}`}
            className="inline-flex items-center gap-1.5 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 px-3 py-1.5 rounded-md transition-colors"
          >
            <Mail size={14} />
            Email
          </a>
        )}
        {p.address && (
          <a
            href={directionsUrl(p)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 px-3 py-1.5 rounded-md transition-colors"
          >
            <MapPin size={14} />
            Mapa
          </a>
        )}
        {p.website && (
          <a
            href={p.website}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 px-3 py-1.5 rounded-md transition-colors"
          >
            <Globe size={14} />
            Sajt
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      {p.phone && (
        <p className="text-xs text-gray-400 dark:text-gray-500">{p.phone}</p>
      )}
    </div>
  );
}
