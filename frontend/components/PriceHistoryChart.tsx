import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import { Price } from "@/types/product";
import { format, subDays } from "date-fns";
import { ChartLine } from "lucide-react";
import { formatPrice } from "@/lib/utils";

interface PriceHistoryProps {
  prices: Price[];
  isInCard?: boolean;
}

// Generate mock history data showing lowest price each day
const generateHistoryData = (prices: Price[]) => {
  const today = new Date();
  const data = [];

  // Generate data for the past 30 days
  for (let i = 30; i >= 0; i--) {
    const date = subDays(today, i);
    const entry: Record<string, string | number> = {
      date: format(date, "MMM dd"),
      fullDate: date.toISOString(),
    };

    // Get base lowest price
    const lowestCurrentPrice = Math.min(...prices.map((p) => p.price));
    // Find store with lowest price
    const lowestStore =
      prices.find((p) => p.price === lowestCurrentPrice)?.store || "Unknown";

    // Add variations except for today
    const variation = i > 0 ? Math.random() * 0.15 - 0.05 : 0; // No variation for today
    const historicalLowestPrice = parseFloat(
      (lowestCurrentPrice * (1 + variation)).toFixed(2)
    );

    // Add lowest price
    entry.lowestPrice = historicalLowestPrice;
    entry.lowestStore = lowestStore;

    data.push(entry);
  }

  return data;
};

export const PriceHistoryChart: React.FC<PriceHistoryProps> = ({
  prices,
  isInCard = false,
}) => {
  const data = generateHistoryData(prices);
  const chartHeight = isInCard ? 200 : 300;

  // Define configuration for the chart
  const config = {
    lowestPrice: {
      label: "Najniža cena",
      theme: {
        light: "#3EB75E", // health primary
        dark: "#3EB75E",
      },
    },
  };

  return (
    <div className="w-full mt-4">
      <div className="flex items-center gap-2 mb-3">
        <ChartLine size={18} className="text-health-primary" />
        <h4 className="text-lg font-medium dark:text-gray-200">
          Istorija cena
        </h4>
      </div>

      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm">
        <ChartContainer
          config={config}
          className="w-full"
          style={{ height: chartHeight }}
        >
          <LineChart
            data={data}
            margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12 }}
              tickMargin={10}
              tickFormatter={(value) =>
                isInCard && data.length > 15 ? value.split(" ")[0] : value
              }
            />
            <YAxis
              tickFormatter={(value) => formatPrice(value)}
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
      </div>
    </div>
  );
};

// Custom tooltip to show both price and store with lowest price
interface TooltipPayload {
  payload: {
    date: string;
    lowestPrice: number;
    lowestStore: string;
  };
}

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-white p-3 border border-gray-200 rounded shadow-md">
        <p className="text-sm text-gray-500">{data.date}</p>
        <p className="text-sm font-medium">{formatPrice(data.lowestPrice)}</p>
        <p className="text-xs text-gray-600">
          Best price at: {data.lowestStore}
        </p>
      </div>
    );
  }
  return null;
};
