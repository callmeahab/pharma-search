"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchCatalogSuggestions, productPath } from "@/lib/catalog";
import { formatPrice } from "@/lib/utils";

type Suggestion = { id: string; title: string; price: number; vendor_name: string };
export default function SearchBar({ onSearch, initialTerm = "" }: { onSearch: (term: string) => void; initialTerm?: string }) {
  const [term, setTerm] = useState(initialTerm);
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [failed, setFailed] = useState(false);
  const request = useRef(0); const listId = useId(); const router = useRouter();
  useEffect(() => {
    if (!focused || term.trim().length < 2) return;
    const generation = ++request.current; const abort = new AbortController();
    const timeout = setTimeout(async () => {
      setLoading(true); setFailed(false);
      try {
        const result = await fetchCatalogSuggestions(term.trim(), abort.signal);
        if (generation === request.current) { setSuggestions(result.suggestions); setActive(-1); }
      } catch {
        if (!abort.signal.aborted && generation === request.current) { setSuggestions([]); setFailed(true); }
      } finally { if (!abort.signal.aborted && generation === request.current) setLoading(false); }
    }, 180);
    return () => { clearTimeout(timeout); abort.abort(); };
  }, [term, focused]);
  const open = focused && term.trim().length >= 2;
  const search = (query: string) => { request.current++; setFocused(false); setTerm(query); onSearch(query.trim()); };
  return (
    <div className="w-full">
      <form className="relative" role="search" onSubmit={event => { event.preventDefault(); search(term); }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <label htmlFor={`${listId}-input`} className="sr-only">Pretraga proizvoda, brenda, doze ili pakovanja</label>
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" aria-hidden="true" />
            <Input id={`${listId}-input`} value={term} maxLength={256} autoComplete="off" className="pl-9 pr-9" placeholder="Proizvod, brend, doza, pakovanje…"
              role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${listId}-list`} aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
              onFocus={() => setFocused(true)} onChange={event => { request.current++; setTerm(event.target.value); setSuggestions([]); setActive(-1); setLoading(false); setFailed(false); setFocused(true); }}
              onKeyDown={event => {
                if (event.key === "Escape") { setFocused(false); setActive(-1); }
                if (event.key === "ArrowDown" && suggestions.length) { event.preventDefault(); setFocused(true); setActive(index => (index + 1) % suggestions.length); }
                if (event.key === "ArrowUp" && suggestions.length) { event.preventDefault(); setActive(index => (index <= 0 ? suggestions.length : index) - 1); }
                if (event.key === "Enter" && open && active >= 0 && suggestions[active]) { event.preventDefault(); setFocused(false); router.push(productPath(suggestions[active].id)); }
              }} />
            {term && <button type="button" aria-label="Obriši pretragu" className="absolute right-2 top-2 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => search("")}><X size={16} /></button>}
          </div>
          <Button type="submit">Pretraži</Button>
        </div>
        {open && <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border bg-white shadow-lg dark:bg-gray-800 dark:border-gray-700">
          <ul id={`${listId}-list`} role="listbox" aria-label="Predlozi proizvoda" className="max-h-80 overflow-y-auto">
            {suggestions.map((item, index) => <li key={item.id} id={`${listId}-${index}`} role="option" aria-selected={active === index} className={active === index ? "bg-health-light dark:bg-gray-700" : ""}>
              <Link href={productPath(item.id)} tabIndex={-1} onMouseDown={event => event.preventDefault()} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => setFocused(false)}>
                <span className="text-sm">{item.title}</span><span className="text-right shrink-0"><span className="text-sm font-medium text-health-primary dark:text-green-300">{formatPrice(item.price)}</span><span className="block text-xs text-gray-500">{item.vendor_name}</span></span>
              </Link>
            </li>)}
          </ul>
          {!suggestions.length && <p role="status" className="flex gap-2 p-4 text-sm text-gray-500">{loading && <Loader2 size={16} className="animate-spin" />}{loading ? "Tražim predloge…" : failed ? "Predlozi trenutno nisu dostupni. Pritisnite Enter za pretragu." : "Nema predloga. Pritisnite Enter za sve rezultate."}</p>}
        </div>}
      </form>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm"><span className="text-gray-500">Popularne pretrage:</span>{["vitamin d", "protein", "omega 3", "probiotik"].map(query => <button key={query} type="button" className="text-health-primary dark:text-green-300 hover:underline" onClick={() => search(query)}>{query}</button>)}</div>
    </div>
  );
}
