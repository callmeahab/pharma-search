"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import PharmacyCard from "@/components/PharmacyCard";
import PharmacyMap from "@/components/PharmacyMap";
import PharmacyPlaceCard from "@/components/PharmacyPlaceCard";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { vendorsApi, Pharmacy, PharmacyPlace } from "@/lib/vendors";
import { MapPin, Search } from "lucide-react";

export const dynamic = "force-dynamic";

const POPULAR_CITY_LIMIT = 8;

type CityStat = {
  key: string;
  name: string;
  count: number;
};

export default function PharmaciesPage() {
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [places, setPlaces] = useState<PharmacyPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [cityKey, setCityKey] = useState<string>("");
  const [selectedPlaceId, setSelectedPlaceId] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([vendorsApi.list(), vendorsApi.places()])
      .then(([vendorRows, placeRows]) => {
        if (!cancelled) {
          setPharmacies(vendorRows);
          setPlaces(placeRows);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cityStats = useMemo<CityStat[]>(() => {
    const counts = new Map<string, CityStat>();
    const rows = places.length > 0 ? places : pharmacies;
    rows.forEach((p) => {
      const key = cityFilterKey(p.city);
      if (!key) return;

      const current = counts.get(key);
      if (current) {
        current.count += 1;
        current.name = preferredCityName(current.name, cityDisplayName(p.city, key));
      } else {
        counts.set(key, { key, name: cityDisplayName(p.city, key), count: 1 });
      }
    });
    return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "sr"));
  }, [pharmacies, places]);
  const visibleCities = useMemo(() => cityStats.slice(0, POPULAR_CITY_LIMIT), [cityStats]);

  const filteredPlaces = useMemo(() => {
    const q = searchableText(query);
    return places.filter((p) => {
      if (cityKey && cityFilterKey(p.city) !== cityKey) return false;
      if (!q) return true;
      return (
        searchableText(p.name).includes(q) ||
        searchableText(p.vendor_name).includes(q) ||
        searchableText(p.city).includes(q) ||
        searchableText(cityDisplayName(p.city)).includes(q) ||
        searchableText(p.address).includes(q) ||
        searchableText(p.formatted_address).includes(q)
      );
    });
  }, [places, query, cityKey]);

  const filteredPharmacies = useMemo(() => {
    const q = searchableText(query);
    return pharmacies.filter((p) => {
      if (cityKey && cityFilterKey(p.city) !== cityKey) return false;
      if (!q) return true;
      return (
        searchableText(p.name).includes(q) ||
        searchableText(p.city).includes(q) ||
        searchableText(cityDisplayName(p.city)).includes(q) ||
        searchableText(p.address).includes(q)
      );
    });
  }, [pharmacies, query, cityKey]);

  useEffect(() => {
    if (filteredPlaces.length === 0) {
      setSelectedPlaceId("");
      return;
    }
    if (!filteredPlaces.some((place) => place.id === selectedPlaceId)) {
      setSelectedPlaceId(filteredPlaces[0].id);
    }
  }, [filteredPlaces, selectedPlaceId]);

  const selectedPlace = filteredPlaces.find((place) => place.id === selectedPlaceId);
  const hasImportedPlaces = places.length > 0;

  return (
    <div className="min-h-screen flex flex-col bg-health-light dark:bg-gray-900">
      <Navbar />
      <main className="flex-grow container mx-auto px-4 py-8">
        <div className="mx-auto max-w-6xl">
          <h1 className="mb-2 text-3xl font-bold text-gray-900 dark:text-white">Lokacije apoteka i prodavnica</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {hasImportedPlaces
              ? `${places.length.toLocaleString("sr-RS")} lokacija za ${pharmacies.length.toLocaleString("sr-RS")} partnera.`
              : `Još nema uvezenih lokacija. Prikazani su partneri iz kataloga.`}
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

          {cityStats.length > 0 && (
            <div className="mb-6 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setCityKey("")}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  cityKey === ""
                    ? "bg-health-primary text-white"
                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                Svi gradovi
              </button>
              {visibleCities.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setCityKey(item.key === cityKey ? "" : item.key)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                    cityKey === item.key
                      ? "bg-health-primary text-white"
                      : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}
                >
                  {item.name}
                </button>
              ))}
              {cityStats.length > POPULAR_CITY_LIMIT && (
                <Select
                  value={cityKey && !visibleCities.some((item) => item.key === cityKey) ? cityKey : "more"}
                  onValueChange={(value) => {
                    if (value === "more") return;
                    setCityKey(value === "all" ? "" : value);
                  }}
                >
                  <SelectTrigger className="h-8 w-full rounded-full border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 sm:w-52">
                    <SelectValue placeholder="Još gradova" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="more" disabled>
                      Još gradova
                    </SelectItem>
                    <SelectItem value="all">Svi gradovi</SelectItem>
                    {cityStats.map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.name} ({item.count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {loading ? (
            <p className="text-center text-gray-500 dark:text-gray-400 py-12">Učitavanje...</p>
          ) : hasImportedPlaces ? (
            filteredPlaces.length === 0 ? (
              <p className="py-12 text-center text-gray-500 dark:text-gray-400">Nema rezultata.</p>
            ) : (
              <>
                <PharmacyMap
                  places={filteredPlaces}
                  selectedId={selectedPlaceId}
                  onSelect={(place) => setSelectedPlaceId(place.id)}
                />

                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {filteredPlaces.length.toLocaleString("sr-RS")} lokacija
                    {selectedPlace ? `, izabrana: ${selectedPlace.name}` : ""}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {filteredPlaces.map((place) => (
                    <PharmacyPlaceCard
                      key={place.id}
                      place={place}
                      selected={place.id === selectedPlaceId}
                      onSelect={(nextPlace) => setSelectedPlaceId(nextPlace.id)}
                    />
                  ))}
                </div>
              </>
            )
          ) : (
            <>
              <section className="mb-6 rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center dark:border-gray-700 dark:bg-gray-800">
                <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-health-light text-health-secondary dark:bg-gray-700 dark:text-health-accent">
                  <MapPin size={22} />
                </div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Lokacije nisu uvezene</h2>
                <p className="mx-auto mt-2 max-w-xl text-sm text-gray-600 dark:text-gray-400">
                  Mapa će se pojaviti ovde kada lokalna baza bude imala sačuvane lokacije za partnere.
                </p>
              </section>

              {filteredPharmacies.length === 0 ? (
                <p className="text-center text-gray-500 dark:text-gray-400 py-12">Nema rezultata.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredPharmacies.map((p) => (
                    <PharmacyCard key={p.id} pharmacy={p} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

const CYRILLIC_TO_LATIN: Record<string, string> = {
  А: "A",
  а: "a",
  Б: "B",
  б: "b",
  В: "V",
  в: "v",
  Г: "G",
  г: "g",
  Д: "D",
  д: "d",
  Ђ: "Đ",
  ђ: "đ",
  Е: "E",
  е: "e",
  Ж: "Ž",
  ж: "ž",
  З: "Z",
  з: "z",
  И: "I",
  и: "i",
  Ј: "J",
  ј: "j",
  К: "K",
  к: "k",
  Л: "L",
  л: "l",
  Љ: "Lj",
  љ: "lj",
  М: "M",
  м: "m",
  Н: "N",
  н: "n",
  Њ: "Nj",
  њ: "nj",
  О: "O",
  о: "o",
  П: "P",
  п: "p",
  Р: "R",
  р: "r",
  С: "S",
  с: "s",
  Т: "T",
  т: "t",
  Ћ: "Ć",
  ћ: "ć",
  У: "U",
  у: "u",
  Ф: "F",
  ф: "f",
  Х: "H",
  х: "h",
  Ц: "C",
  ц: "c",
  Ч: "Č",
  ч: "č",
  Џ: "Dž",
  џ: "dž",
  Ш: "Š",
  ш: "š",
};

const CITY_KEY_ALIASES: Record<string, string> = {
  belgrade: "beograd",
  belgrado: "beograd",
  "new belgrade": "novi beograd",
  "opstina arandjelovac": "arandjelovac",
  "opstina arandelovac": "arandjelovac",
  "stara pazova": "stara pazova",
  "stara-pazova": "stara pazova",
};

const CITY_DISPLAY_NAMES: Record<string, string> = {
  arandjelovac: "Aranđelovac",
  bajmok: "Bajmok",
  beograd: "Beograd",
  bor: "Bor",
  cacak: "Čačak",
  cajetina: "Čajetina",
  divcibare: "Divčibare",
  kikinda: "Kikinda",
  kovacica: "Kovačica",
  kraljevo: "Kraljevo",
  kragujevac: "Kragujevac",
  krusevac: "Kruševac",
  leskovac: "Leskovac",
  nis: "Niš",
  "novi beograd": "Novi Beograd",
  "novi pazar": "Novi Pazar",
  "novi sad": "Novi Sad",
  pancevo: "Pančevo",
  paracin: "Paraćin",
  pozarevac: "Požarevac",
  pozega: "Požega",
  sabac: "Šabac",
  smederevo: "Smederevo",
  sombor: "Sombor",
  "sremska mitrovica": "Sremska Mitrovica",
  "stara pazova": "Stara Pazova",
  subotica: "Subotica",
  trsic: "Tršić",
  uzice: "Užice",
  valjevo: "Valjevo",
  vrsac: "Vršac",
  zajecar: "Zaječar",
  zrenjanin: "Zrenjanin",
};

function cityFilterKey(value: string): string {
  const folded = foldText(value);
  return CITY_KEY_ALIASES[folded] || folded;
}

function cityDisplayName(value: string, key = cityFilterKey(value)): string {
  if (!key) return "";
  return CITY_DISPLAY_NAMES[key] || titleCase(transliterateSerbian(value || key));
}

function preferredCityName(current: string, next: string): string {
  if (!current) return next;
  if (!next) return current;
  if (hasCyrillic(current) && !hasCyrillic(next)) return next;
  if (!hasDiacritics(current) && hasDiacritics(next)) return next;
  if (current.length > next.length && foldText(current) === foldText(next)) return next;
  return current;
}

function searchableText(value: string): string {
  return foldText(value);
}

function foldText(value: string): string {
  return transliterateSerbian(value)
    .replace(/[Đđ]/g, (char) => (char === "Đ" ? "Dj" : "dj"))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function transliterateSerbian(value: string): string {
  return Array.from(value || "")
    .map((char) => CYRILLIC_TO_LATIN[char] || char)
    .join("");
}

function titleCase(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase("sr-RS") + word.slice(1).toLocaleLowerCase("sr-RS"))
    .join(" ");
}

function hasCyrillic(value: string): boolean {
  return /[\u0400-\u04ff]/.test(value);
}

function hasDiacritics(value: string): boolean {
  return /[čćđšžČĆĐŠŽ]/.test(value);
}
