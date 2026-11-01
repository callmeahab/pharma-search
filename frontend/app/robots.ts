import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots { return { rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/profil", "/prijava", "/registracija", "/reset-lozinke", "/magic-link"] }, sitemap: "https://aposteka.rs/sitemap.xml" }; }
