"use client";
import { useState } from "react";
import Image from "next/image";
import { Heart, Copy } from "lucide-react";
import { Button } from "./ui/button";
import { useAuth } from "@/contexts/AuthContext";
import type { ProductGroup } from "@/types/product";

export function ProductPageActions({ group }: { group: ProductGroup }) {
  const { isWatched, toggleWatch } = useAuth(); const [copied, setCopied] = useState(false);
  return <div className="flex flex-wrap items-center gap-3"><Button onClick={() => toggleWatch({ groupKey: group.id, displayName: group.normalized_name, thumbnail: group.products[0]?.thumbnail })} aria-pressed={isWatched(group.id)}><Heart size={16} className={isWatched(group.id) ? "fill-current" : ""} />{isWatched(group.id) ? "Pratite cenu" : "Prati cenu"}</Button><Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); setCopied(true); } catch { setCopied(false); } }}><Copy size={16} />Kopiraj link</Button>{copied && <span role="status" className="text-sm">Link je kopiran.</span>}</div>;
}
export function ProductImage({ src, alt }: { src?: string; alt: string }) { const [failed, setFailed] = useState(false); return <Image unoptimized src={!src || failed ? "/medicine-placeholder.svg" : src} alt={alt} width={320} height={320} className="w-full h-72 object-contain rounded-lg bg-white" onError={() => setFailed(true)} />; }
