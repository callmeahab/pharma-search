"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) { return <main className="container mx-auto px-4 py-16 max-w-xl"><h1 className="text-2xl font-bold">Stranica trenutno nije dostupna</h1><p className="my-4 text-gray-500">Podaci nisu učitani. Pokušajte ponovo za nekoliko trenutaka.</p><div className="flex gap-4 items-center"><Button onClick={reset}>Pokušaj ponovo</Button><Link href="/" className="underline">Početna stranica</Link></div></main>; }
