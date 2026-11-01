"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { readAnalyticsConsent } from "@/lib/analytics-consent";
import { setCookieConsent } from "@/utils/analytics";

function subscribe(callback: () => void) { window.addEventListener("analyticsConsentChanged", callback); window.addEventListener("storage", callback); return () => { window.removeEventListener("analyticsConsentChanged", callback); window.removeEventListener("storage", callback); }; }
export default function CookieConsent() {
  const consent = useSyncExternalStore(subscribe, readAnalyticsConsent, () => "unset"); const [editing, setEditing] = useState(false);
  useEffect(() => { const open = () => setEditing(true); window.addEventListener("openCookieSettings", open); return () => window.removeEventListener("openCookieSettings", open); }, []);
  if (consent !== "unset" && !editing) return null;
  const choose = (accepted: boolean) => { setCookieConsent(accepted); setEditing(false); };
  return <section aria-label="Podešavanja kolačića" className="fixed bottom-0 inset-x-0 z-50 border-t bg-white p-4 shadow-lg dark:bg-gray-800 dark:border-gray-700"><div className="container mx-auto flex flex-wrap items-center justify-between gap-4"><div className="max-w-2xl"><h2 className="font-semibold">Vaš izbor privatnosti</h2><p className="text-sm text-gray-600 dark:text-gray-300 mt-1">Neophodni podaci služe prijavi i čuvanju podešavanja. Analitika je opciona i uključuje se samo uz vaš pristanak. Tekst pretraga i nazive proizvoda ne šaljemo analitici. <Link href="/privatnost" className="underline">Politika privatnosti</Link></p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => choose(false)}>Samo neophodni</Button><Button onClick={() => choose(true)}>Prihvati analitiku</Button></div></div></section>;
}
