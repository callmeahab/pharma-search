"use client";

import React, { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { format } from "date-fns";
import { ChartLine, Loader2 } from "lucide-react";
import { ChartContainer } from "@/components/ui/chart";
import { getPriceHistory, PriceHistoryPoint } from "@/lib/api";
import { formatPrice } from "@/lib/utils";

interface PriceHistoryProps {
  groupKey?: string;
  isInCard?: boolean;
}

type ChartPoint = {
  date: string;
  fullDate: string;
  lowestPrice: number;
};

export const PriceHistoryChart: React.FC<PriceHistoryProps> = ({
  groupKey,
  isInCard = false,
}) => {
  const [points, setPoints] = useState<PriceHistoryPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const chartHeight = isInCard ? 200 : 300;

  useEffect(() => {
    if (!groupKey) return;

    let cancelled = false;
    setLoading(true);
    setError("");

    getPriceHistory(groupKey)
      .then((historyPoints) => {
        if (!cancelled) setPoints(historyPoints);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setPoints([]);
          setError(nextError instanceof Error ? nextError.message : "Nije moguće učitati istoriju cena.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [groupKey]);

  const data = points.map(toChartPoint);

  const config = {
    lowestPrice: {
      label: "Najniža cena",
      theme: {
        light: "#3EB75E",
        dark: "#3EB75E",
      },
    },
  };

  return (
    <div className="w-full mt-4">
      <div className="mb-3 flex items-center gap-2">
        <ChartLine size={18} className="text-health-primary" />
        <h4 className="text-lg font-medium dark:text-gray-200">Istorija cena</h4>
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800">
        {!groupKey ? (
          <EmptyHistory message="Istorija cena nije dostupna za ovu ponudu." />
        ) : loading ? (
          <div className="flex h-40 items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Učitavanje istorije cena...
          </div>
        ) : error ? (
          <EmptyHistory message={error} />
        ) : data.length === 0 ? (
          <EmptyHistory message="Još nemamo zabeleženu istoriju cena za ovaj proizvod." />
        ) : (
          <ChartContainer config={config} className="w-full" style={{ height: chartHeight }}>
            <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12 }}
                tickMargin={10}
                tickFormatter={(value) =>
                  isInCard && data.length > 15 ? String(value).split(" ")[0] : String(value)
                }
              />
              <YAxis
                tickFormatter={(value) => formatPrice(Number(value))}
                tick={{ fontSize: 12 }}
                domain={["dataMin - 1", "dataMax + 1"]}
                tickMargin={10}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Line
                type="monotone"
                dataKey="lowestPrice"
                name="Najniža cena"
                stroke="#3EB75E"
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ChartContainer>
        )}
      </div>
    </div>
  );
};

function EmptyHistory({ message }: { message: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed border-gray-200 px-4 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
      {message}
    </div>
  );
}

function toChartPoint(point: PriceHistoryPoint): ChartPoint {
  const date = new Date(point.recorded_at);
  return {
    date: Number.isNaN(date.getTime()) ? "" : format(date, "MMM dd"),
    fullDate: point.recorded_at,
    lowestPrice: point.min_price,
  };
}

interface TooltipPayload {
  payload: ChartPoint;
}

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const date = new Date(data.fullDate);
    return (
      <div className="rounded border border-gray-200 bg-white p-3 shadow-md dark:border-gray-700 dark:bg-gray-900">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {Number.isNaN(date.getTime()) ? data.date : date.toLocaleDateString("sr-RS")}
        </p>
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {formatPrice(data.lowestPrice)}
        </p>
      </div>
    );
  }
  return null;
};
