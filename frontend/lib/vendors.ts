// Pharmacy (vendor) directory client. Hits the Go backend's public JSON endpoint.

function apiBase(): string {
  if (typeof window === "undefined") return "";
  return process.env.NODE_ENV === "production"
    ? window.location.origin
    : "http://localhost:50051";
}

export interface Pharmacy {
  id: string;
  name: string;
  website: string;
  logo: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  hours: string;
  maps_url: string;
  latitude: number | null;
  longitude: number | null;
  product_count: number;
  location_count: number;
}

export interface PharmacyPlace {
  id: string;
  vendor_id: string;
  vendor_name: string;
  vendor_website: string;
  vendor_logo: string;
  product_count: number;
  foursquare_id: string;
  name: string;
  address: string;
  city: string;
  region: string;
  postcode: string;
  country: string;
  formatted_address: string;
  phone: string;
  email: string;
  website: string;
  hours_display: string;
  open_now: boolean | null;
  latitude: number;
  longitude: number;
  rating: number | null;
  popularity: number | null;
  price: number | null;
  maps_url: string;
  categories: string[];
  fetched_at: string;
}

export const vendorsApi = {
  list: async (): Promise<Pharmacy[]> => {
    const res = await fetch(`${apiBase()}/api/vendors`);
    if (!res.ok) throw new Error(`Greška (${res.status})`);
    const data = await res.json();
    return (data.vendors || []) as Pharmacy[];
  },
  places: async (): Promise<PharmacyPlace[]> => {
    const res = await fetch(`${apiBase()}/api/vendor-places`);
    if (!res.ok) throw new Error(`Greška (${res.status})`);
    const data = await res.json();
    return (data.places || []) as PharmacyPlace[];
  },
};

// Returns a directions URL: the explicit mapsUrl if present, otherwise a Google
// Maps search built from the pharmacy's address (or name).
export function directionsUrl(p: Pharmacy): string {
  if (p.maps_url) return p.maps_url;
  const q = [p.name, p.address, p.city].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function placeDirectionsUrl(p: PharmacyPlace): string {
  if (p.maps_url) return p.maps_url;
  const q = [p.name, p.formatted_address || p.address, p.city].filter(Boolean).join(", ");
  if (q) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  return `https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`;
}

// Normalizes a phone string to a tel: href (first listed number, digits + leading +).
export function telHref(phone: string): string {
  const first = phone.split(/[,/]/)[0].trim();
  const cleaned = first.replace(/[^\d+]/g, "");
  return `tel:${cleaned}`;
}
