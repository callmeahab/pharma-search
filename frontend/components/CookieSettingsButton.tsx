"use client";
export default function CookieSettingsButton() { return <button type="button" className="mt-2 text-sm underline hover:text-health-primary" onClick={() => window.dispatchEvent(new Event("openCookieSettings"))}>Podešavanja kolačića</button>; }
