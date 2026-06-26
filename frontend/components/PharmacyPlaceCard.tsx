"use client";

import { Clock, ExternalLink, Globe, Mail, MapPin, Phone, Star } from "lucide-react";
import { PharmacyPlace, placeDirectionsUrl, telHref } from "@/lib/vendors";

export default function PharmacyPlaceCard({
  place,
  selected,
  onSelect,
}: {
  place: PharmacyPlace;
  selected?: boolean;
  onSelect?: (place: PharmacyPlace) => void;
}) {
  const address = place.formatted_address || [place.address, place.city].filter(Boolean).join(", ");
  const website = place.website || place.vendor_website;
  const photo = place.photos?.[0];
  const hoursSummary = formatHoursDisplay(place.hours_display);
  const categories = placeCategoryLabels(place.categories);

  return (
    <article
      className={`bg-white dark:bg-gray-800 rounded-lg border p-5 shadow-sm transition-colors ${
        selected
          ? "border-health-primary ring-2 ring-health-primary/20"
          : "border-gray-200 dark:border-gray-700"
      }`}
    >
      {photo?.url && (
        <div className="-mx-5 -mt-5 mb-4 aspect-[16/9] overflow-hidden rounded-t-lg bg-gray-100 dark:bg-gray-900">
          {/* eslint-disable-next-line @next/next/no-img-element -- Foursquare place photos are remote runtime URLs */}
          <img
            src={photo.original_url || photo.url}
            alt={place.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onSelect?.(place)}
            className="text-left font-semibold text-gray-900 dark:text-white hover:text-health-primary dark:hover:text-health-accent"
          >
            {place.name}
          </button>
          <p className="text-sm text-gray-500 dark:text-gray-400">{place.vendor_name}</p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {place.open_now !== null && (
            <span
              className={`text-xs px-2 py-1 rounded-full ${
                place.open_now
                  ? "bg-health-light text-health-secondary dark:bg-gray-700 dark:text-health-accent"
                  : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300"
              }`}
            >
              {place.open_now ? "Otvoreno" : "Zatvoreno"}
            </span>
          )}
          {place.rating !== null && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              <Star size={13} className="text-amber-500" />
              {place.rating.toFixed(1)}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-2 text-sm">
        {address && (
          <div className="flex items-start gap-2 text-gray-700 dark:text-gray-300">
            <MapPin size={16} className="mt-0.5 shrink-0 text-gray-400" />
            <span>{address}</span>
          </div>
        )}
        {hoursSummary && (
          <div className="flex items-start gap-2 text-gray-700 dark:text-gray-300">
            <Clock size={16} className="mt-0.5 shrink-0 text-gray-400" />
            <span className="whitespace-pre-line">{hoursSummary}</span>
          </div>
        )}
      </div>

      {categories.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {categories.map((category) => (
            <span
              key={category}
              className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300"
            >
              {category}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {place.phone && (
          <a
            href={telHref(place.phone)}
            className="inline-flex items-center gap-1.5 rounded-md bg-health-primary px-3 py-1.5 text-sm text-white transition-colors hover:bg-health-secondary"
          >
            <Phone size={14} />
            Pozovi
          </a>
        )}
        {place.email && (
          <a
            href={`mailto:${place.email}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <Mail size={14} />
            Email
          </a>
        )}
        <a
          href={placeDirectionsUrl(place)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          <MapPin size={14} />
          Mapa
        </a>
        {website && (
          <a
            href={website}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <Globe size={14} />
            Sajt
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      {place.phone && <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">{place.phone}</p>}
    </article>
  );
}

const MAX_HOUR_LINES = 3;
const WEEKDAY_LABELS = ["Ned", "Pon", "Uto", "Sre", "Čet", "Pet", "Sub"];
const CATEGORY_LABELS: Record<string, string> = {
  drugstore: "Drogerija",
  "health food store": "Suplementi",
  pharmacy: "Apoteka",
  "supplement shop": "Suplementi",
  "vitamins and supplements store": "Suplementi",
};

function formatHoursDisplay(value: string): string {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";

  const parsedRanges = lines.map(parseTomTomDateRange);
  const usesDateRanges = parsedRanges.every(Boolean);
  const displayLines = usesDateRanges
    ? currentTomTomRanges(parsedRanges as TomTomDateRange[]).map(formatTomTomDateRange)
    : lines.map(localizeOpeningHoursLine);
  const visibleLines = displayLines.slice(0, MAX_HOUR_LINES);
  const hiddenCount = displayLines.length - visibleLines.length;
  if (hiddenCount > 0) {
    visibleLines.push(`+${hiddenCount.toLocaleString("sr-RS")} ${usesDateRanges ? "dana" : "termina"}`);
  }
  return visibleLines.join("\n");
}

type TomTomDateRange = {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
};

function parseTomTomDateRange(line: string): TomTomDateRange | null {
  const match = line.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})-(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/);
  if (!match) return null;

  const [, startDate, startTime, endDate, endTime] = match;
  return { startDate, startTime, endDate, endTime };
}

function currentTomTomRanges(ranges: TomTomDateRange[]): TomTomDateRange[] {
  const todayKey = localDateKey(new Date());
  const currentRanges = ranges.filter((range) => range.startDate >= todayKey);
  return currentRanges.length > 0 ? currentRanges : ranges;
}

function formatTomTomDateRange({ startDate, startTime, endDate, endTime }: TomTomDateRange): string {
  const startLabel = relativeDateLabel(startDate);
  if (startDate === endDate) {
    return `${startLabel} ${startTime}-${endTime}`;
  }
  return `${startLabel} ${startTime}-${relativeDateLabel(endDate)} ${endTime}`;
}

function relativeDateLabel(dateKey: string): string {
  const date = dateFromKey(dateKey);
  if (!date) return dateKey;

  const today = new Date();
  const todayKey = localDateKey(today);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (dateKey === todayKey) return "Danas";
  if (dateKey === localDateKey(tomorrow)) return "Sutra";
  return WEEKDAY_LABELS[date.getDay()];
}

function dateFromKey(dateKey: string): Date | null {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const OPENING_HOURS_LABELS: Record<string, string> = {
  fr: "Pet",
  mo: "Pon",
  off: "zatvoreno",
  open: "otvoreno",
  ph: "praznici",
  sa: "Sub",
  sh: "školski praznici",
  su: "Ned",
  th: "Čet",
  tu: "Uto",
  we: "Sre",
};

function localizeOpeningHoursLine(line: string): string {
  return line.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH|SH|open|off)\b/gi, (token) => {
    return OPENING_HOURS_LABELS[token.toLowerCase()] || token;
  });
}

function placeCategoryLabels(categories: string[]): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();

  for (const category of categories || []) {
    const normalized = category.trim().toLowerCase().replace(/\s+/g, " ");
    if (!normalized || seen.has(normalized)) continue;

    const label = CATEGORY_LABELS[normalized] || titleCase(category.trim());
    const labelKey = label.toLowerCase();
    if (seen.has(labelKey)) continue;

    seen.add(normalized);
    seen.add(labelKey);
    labels.push(label);
  }

  return labels.slice(0, 2);
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase("sr-RS") + word.slice(1).toLocaleLowerCase("sr-RS"))
    .join(" ");
}
