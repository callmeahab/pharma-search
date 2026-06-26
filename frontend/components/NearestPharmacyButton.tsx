"use client";

import { useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatPrice } from "@/lib/utils";
import { PharmacyPlace, vendorsApi } from "@/lib/vendors";

type NearestPharmacyButtonProps = {
  vendorId?: string;
  vendorName: string;
  productName?: string;
  price?: number;
  className?: string;
  size?: "default" | "sm";
};

type UserPosition = {
  latitude: number;
  longitude: number;
};

let placesPromise: Promise<PharmacyPlace[]> | null = null;

export default function NearestPharmacyButton({
  vendorId,
  vendorName,
  productName,
  price,
  className,
  size = "sm",
}: NearestPharmacyButtonProps) {
  const [status, setStatus] = useState<"idle" | "confirming" | "loading">("idle");
  const [message, setMessage] = useState("");

  const handleClick = () => {
    setMessage("");
    setStatus("confirming");
  };

  const handleAllowLocation = async () => {
    setStatus("loading");
    setMessage("");

    try {
      const [places, position] = await Promise.all([getPlaces(), getUserPosition()]);
      const vendorPlaces = places.filter((place) => matchesVendor(place, vendorId, vendorName));

      if (vendorPlaces.length === 0) {
        setMessage("Nemamo sačuvane lokacije za ovog partnera.");
        return;
      }

      const nearest = vendorPlaces.reduce((best, place) => {
        const distance = distanceMeters(position, place);
        if (!best || distance < best.distance) return { place, distance };
        return best;
      }, null as { place: PharmacyPlace; distance: number } | null);

      if (!nearest) {
        setMessage("Nije pronađena lokacija partnera.");
        return;
      }

      openMaps(nearest.place, position);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Nije moguće pronaći najbližu lokaciju.");
    } finally {
      setStatus("idle");
    }
  };

  const handleCancelLocation = () => {
    setStatus("idle");
    setMessage("");
  };

  const label = price != null ? `Najbliža lokacija za ${formatPrice(price)}` : "Najbliža lokacija";

  return (
    <div className={cn("space-y-1", className)}>
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={status === "loading"}
        onClick={handleClick}
        className="w-full border-health-primary/50 text-health-primary hover:bg-health-light dark:border-green-500/60 dark:text-green-300 dark:hover:bg-green-950/40"
      >
        {status === "loading" ? <Loader2 className="animate-spin" /> : <MapPin />}
        <span className="min-w-0 truncate">{status === "loading" ? "Tražim najbližu lokaciju..." : label}</span>
      </Button>
      {status === "confirming" && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-gray-700 dark:border-green-900/70 dark:bg-green-950/30 dark:text-gray-200">
          <p>
            Koristićemo vašu trenutnu lokaciju samo da pronađemo najbližu lokaciju za ovu cenu.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleAllowLocation}
              className="bg-health-primary text-white hover:bg-health-secondary"
            >
              Dozvoli lokaciju
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={handleCancelLocation}>
              Odustani
            </Button>
          </div>
        </div>
      )}
      {message && (
        <p className="text-xs text-red-600 dark:text-red-400" role="status">
          {message}
        </p>
      )}
      {productName && <span className="sr-only">Proizvod: {productName}</span>}
    </div>
  );
}

function getPlaces(): Promise<PharmacyPlace[]> {
  placesPromise ||= vendorsApi.places();
  return placesPromise;
}

function getUserPosition(): Promise<UserPosition> {
  if (!navigator.geolocation) {
    return Promise.reject(new Error("Pregledač ne podržava deljenje lokacije."));
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new Error("Dozvolite pristup lokaciji da bismo našli najbližu lokaciju."));
          return;
        }
        reject(new Error("Nije moguće odrediti vašu lokaciju."));
      },
      { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 }
    );
  });
}

function matchesVendor(place: PharmacyPlace, vendorId: string | undefined, vendorName: string): boolean {
  if (vendorId && place.vendor_id === vendorId) return true;

  const expected = normalizeVendorName(vendorName);
  const actual = normalizeVendorName(place.vendor_name);
  return expected !== "" && (actual === expected || actual.includes(expected) || expected.includes(actual));
}

function normalizeVendorName(value: string): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(apoteka|pharmacy|online|webshop|web shop)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function distanceMeters(origin: UserPosition, place: PharmacyPlace): number {
  const earthRadiusMeters = 6371000;
  const originLat = toRadians(origin.latitude);
  const placeLat = toRadians(place.latitude);
  const deltaLat = toRadians(place.latitude - origin.latitude);
  const deltaLng = toRadians(place.longitude - origin.longitude);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(originLat) * Math.cos(placeLat) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function openMaps(place: PharmacyPlace, origin: UserPosition) {
  const destination = `${place.latitude},${place.longitude}`;
  const originParam = `${origin.latitude},${origin.longitude}`;
  const label = encodeURIComponent(place.name || place.vendor_name || "Lokacija");
  const googleUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originParam)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;

  if (!isPhone()) {
    window.open(googleUrl, "_blank", "noopener,noreferrer");
    return;
  }

  const appUrl = isIOS()
    ? `maps://?daddr=${encodeURIComponent(destination)}&q=${label}`
    : `geo:0,0?q=${encodeURIComponent(`${destination}(${place.name || place.vendor_name || "Lokacija"})`)}`;

  let fallbackTimer: number | undefined;
  const clearFallback = () => {
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pagehide", clearFallback);
  };
  const handleVisibilityChange = () => {
    if (document.hidden) clearFallback();
  };

  document.addEventListener("visibilitychange", handleVisibilityChange, { once: true });
  window.addEventListener("pagehide", clearFallback, { once: true });
  fallbackTimer = window.setTimeout(() => {
    window.location.href = googleUrl;
  }, 900);
  window.location.href = appUrl;
}

function isPhone(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isIOS(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}
