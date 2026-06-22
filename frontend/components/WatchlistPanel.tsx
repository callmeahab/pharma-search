"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Bell, Trash2, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { Watch, watchApi, PricePoint } from "@/lib/auth";
import { toast } from "@/hooks/use-toast";

function formatRsd(v: number | null | undefined): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("sr-RS", { maximumFractionDigits: 0 }).format(v) + " RSD";
}

export default function WatchlistPanel() {
  const { watches, toggleWatch, setTarget, alerts, refreshAlerts } = useAuth();

  useEffect(() => {
    refreshAlerts();
  }, [refreshAlerts]);

  return (
    <div className="space-y-8">
      {alerts.length > 0 && (
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <Bell size={18} className="text-health-primary dark:text-health-accent" />
            Obaveštenja o cenama
          </h3>
          <div className="space-y-2">
            {alerts.slice(0, 10).map((a, i) => (
              <Link
                key={i}
                href={`/?q=${encodeURIComponent(a.display_name)}`}
                className="flex items-center gap-3 rounded-md bg-green-50 dark:bg-green-900/20 px-4 py-3 text-sm hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
              >
                <TrendingDown size={18} className="text-green-600 dark:text-green-400 shrink-0" />
                <span className="flex-grow text-gray-800 dark:text-gray-200">
                  <strong>{a.display_name}</strong> —{" "}
                  {a.old_price != null && a.new_price != null ? (
                    <>
                      cena pala sa {formatRsd(a.old_price)} na{" "}
                      <span className="font-semibold text-green-700 dark:text-green-400">{formatRsd(a.new_price)}</span>
                      {a.vendor ? ` (${a.vendor})` : ""}
                    </>
                  ) : (
                    a.kind
                  )}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Praćeni proizvodi</h3>
        {watches.length === 0 ? (
          <div className="text-center py-10 text-gray-500 dark:text-gray-400">
            <p className="mb-3">Još uvek ne pratite nijedan proizvod.</p>
            <Link href="/" className="text-health-primary hover:underline dark:text-health-accent">
              Pretražite proizvode i kliknite na srce da pratite cenu
            </Link>
          </div>
        ) : (
          <div className="divide-y dark:divide-gray-700 border dark:border-gray-700 rounded-lg overflow-hidden">
            {watches.map((w) => (
              <WatchRow key={w.id} watch={w} onRemove={toggleWatch} onSetTarget={setTarget} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WatchRow({
  watch,
  onRemove,
  onSetTarget,
}: {
  watch: Watch;
  onRemove: (t: { groupKey: string }) => Promise<void>;
  onSetTarget: (groupKey: string, target: number | null) => Promise<void>;
}) {
  const [target, setTargetVal] = useState<string>(watch.target_price != null ? String(watch.target_price) : "");
  const [saving, setSaving] = useState(false);

  const saveTarget = async () => {
    setSaving(true);
    try {
      const val = target.trim() === "" ? null : Number(target);
      if (val != null && (isNaN(val) || val <= 0)) {
        toast({ title: "Greška", description: "Unesite ispravnu ciljnu cenu." });
        return;
      }
      await onSetTarget(watch.group_key, val);
      toast({ title: "Sačuvano", description: val ? `Obavestićemo vas ispod ${formatRsd(val)}.` : "Ciljna cena uklonjena." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-4 p-4 bg-white dark:bg-gray-800">
      <div className="relative w-14 h-14 shrink-0 rounded bg-gray-50 dark:bg-gray-700 overflow-hidden">
        {watch.thumbnail ? (
          <Image src={watch.thumbnail} alt={watch.display_name} fill sizes="56px" className="object-contain" />
        ) : null}
      </div>
      <div className="flex-grow min-w-0">
        <Link
          href={`/?q=${encodeURIComponent(watch.display_name)}`}
          className="block font-medium text-gray-900 dark:text-white truncate hover:text-health-primary dark:hover:text-health-accent"
        >
          {watch.display_name || "Proizvod"}
        </Link>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Trenutno najjeftinije: <span className="font-semibold text-gray-700 dark:text-gray-200">{formatRsd(watch.last_price)}</span>
          {watch.last_vendor ? ` · ${watch.last_vendor}` : ""}
        </p>
        <PriceSparkline groupKey={watch.group_key} />
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex flex-col">
          <label className="text-[11px] text-gray-400 mb-0.5">Ciljna cena</label>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              value={target}
              onChange={(e) => setTargetVal(e.target.value)}
              placeholder="—"
              className="w-24 h-9"
            />
            <Button size="sm" variant="outline" onClick={saveTarget} disabled={saving} className="h-9">
              {saving ? "..." : "OK"}
            </Button>
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => onRemove({ groupKey: watch.group_key })}
          className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
          aria-label="Ukloni iz praćenja"
        >
          <Trash2 size={18} />
        </Button>
      </div>
    </div>
  );
}

// PriceSparkline draws a tiny inline price-history chart from GroupPriceHistory.
// Renders nothing until at least two data points exist.
function PriceSparkline({ groupKey }: { groupKey: string }) {
  const [points, setPoints] = useState<PricePoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    watchApi
      .history(groupKey)
      .then((r) => {
        if (!cancelled) setPoints(r.points || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [groupKey]);

  if (points.length < 2) return null;

  const w = 160;
  const h = 28;
  const prices = points.map((p) => p.min_price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const coords = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * (w - 2) + 1;
    const y = h - 1 - ((p - min) / span) * (h - 2);
    return [x, y] as const;
  });
  const path = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = prices[prices.length - 1];
  const first = prices[0];
  const trendColor = last < first ? "#16a34a" : last > first ? "#dc2626" : "#9ca3af";

  return (
    <svg width={w} height={h} className="mt-1 overflow-visible" aria-label="Istorija cena">
      <path d={path} fill="none" stroke={trendColor} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r={2.5} fill={trendColor} />
    </svg>
  );
}
