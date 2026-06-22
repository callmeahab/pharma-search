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
}

export const vendorsApi = {
  list: async (): Promise<Pharmacy[]> => {
    const res = await fetch(`${apiBase()}/api/vendors`);
    if (!res.ok) throw new Error(`Greška (${res.status})`);
    const data = await res.json();
    return (data.vendors || []) as Pharmacy[];
  },
};

// Returns a directions URL: the explicit mapsUrl if present, otherwise a Google
// Maps search built from the pharmacy's address (or name).
export function directionsUrl(p: Pharmacy): string {
  if (p.maps_url) return p.maps_url;
  const q = [p.name, p.address, p.city].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

// Normalizes a phone string to a tel: href (first listed number, digits + leading +).
export function telHref(phone: string): string {
  const first = phone.split(/[,/]/)[0].trim();
  const cleaned = first.replace(/[^\d+]/g, "");
  return `tel:${cleaned}`;
}
