"use client";

import { createChart, ColorType, createSeriesMarkers, LineSeries, LineStyle, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type LineData, type SeriesMarker, type Time } from "lightweight-charts";
import { useEffect, useRef } from "react";
import { formatPrice } from "@/lib/strategy";
import type { Candle, RangeLevels, Trade } from "@/lib/strategy-types";

type ChartTheme = "dark" | "light";

const chartThemeColors: Record<ChartTheme, { background: string; text: string; grid: string; border: string }> = {
  dark: {
    background: "#091013",
    text: "#90a4ae",
    grid: "#26333c",
    border: "#26333c"
  },
  light: {
    background: "#f8fbfc",
    text: "#627482",
    grid: "#c7d7dd",
    border: "#c7d7dd"
  }
};

function getPriceFormat(candles: Candle[]) {
  const max = Math.max(...candles.map((candle) => candle.close), 0);
  const precision = max >= 1 ? 4 : max >= 0.01 ? 6 : 8;
  return {
    type: "price" as const,
    precision,
    minMove: 10 ** -precision
  };
}

export function PriceChart({ candles, levels, trades, pair, theme }: { candles: Candle[]; levels: RangeLevels | null; trades: Trade[]; pair: string; theme: ChartTheme }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lowRef = useRef<ISeriesApi<"Line"> | null>(null);
  const highRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const colors = chartThemeColors[theme];
    const chart = createChart(containerRef.current, {
      height: 520,
      layout: {
        background: { type: ColorType.Solid, color: colors.background },
        textColor: colors.text
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid }
      },
      rightPriceScale: {
        borderColor: colors.border
      },
      timeScale: {
        borderColor: colors.border,
        timeVisible: false
      },
      crosshair: {
        mode: 1
      }
    });

    const series = chart.addSeries(LineSeries, {
      color: "#35d5df",
      lineWidth: 2,
      priceFormat: { type: "price", precision: 8, minMove: 0.00000001 }
    });
    const low = chart.addSeries(LineSeries, {
      color: "#9df16b",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: { type: "price", precision: 8, minMove: 0.00000001 }
    });
    const high = chart.addSeries(LineSeries, {
      color: "#ff6b6b",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: { type: "price", precision: 8, minMove: 0.00000001 }
    });

    chartRef.current = chart;
    seriesRef.current = series;
    lowRef.current = low;
    highRef.current = high;
    markersRef.current = createSeriesMarkers(series);

    const observer = new ResizeObserver(([entry]) => {
      chart.applyOptions({ width: entry.contentRect.width });
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    const priceFormat = getPriceFormat(candles);
    const data: LineData[] = candles.map((candle) => ({ time: candle.date as Time, value: candle.close }));
    seriesRef.current?.applyOptions({ priceFormat });
    lowRef.current?.applyOptions({ priceFormat });
    highRef.current?.applyOptions({ priceFormat });
    seriesRef.current?.setData(data);

    if (levels && candles.length > 0) {
      const levelTimes = candles.map((candle) => candle.date as Time);
      lowRef.current?.setData(levelTimes.map((time) => ({ time, value: levels.low20 })));
      highRef.current?.setData(levelTimes.map((time) => ({ time, value: levels.high80 })));
    }

    const markers = trades
      .flatMap<SeriesMarker<Time>>((trade) => {
        const openColor = trade.direction === "buy" ? "#9df16b" : "#ff6b6b";
        const tradeMarkers: SeriesMarker<Time>[] = [
          {
            time: trade.openDate as Time,
            position: trade.direction === "buy" ? "belowBar" as const : "aboveBar" as const,
            color: openColor,
            shape: "circle" as const,
            text: `${trade.direction === "buy" ? "Buy" : "Sell"} ${trade.baseAmount} @ ${formatPrice(trade.openPrice)}`
          }
        ];
        if (trade.closeDate && trade.closePrice) {
          tradeMarkers.push({
            time: trade.closeDate as Time,
            position: trade.direction === "buy" ? "aboveBar" as const : "belowBar" as const,
            color: "#f0b94d",
            shape: "circle" as const,
            text: `Close @ ${formatPrice(trade.closePrice)}`
          });
        }
        return tradeMarkers;
      })
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));

    markersRef.current?.setMarkers(markers);

    chartRef.current?.timeScale().fitContent();
  }, [candles, levels, trades, theme]);

  return (
    <div className="p-4">
      <div ref={containerRef} className="h-[520px] min-w-0 border border-grid bg-ink" />
      <div className="mt-3 flex flex-wrap gap-3 font-mono text-xs text-slate-500">
        <span className="text-cyan">{pair} close</span>
        <span className="text-lime">20% buy threshold</span>
        <span className="text-danger">80% sell threshold</span>
        <span>scroll to zoom · drag to pan</span>
      </div>
    </div>
  );
}
