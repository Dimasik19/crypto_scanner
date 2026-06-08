import type { Candle, RangeLevels, Trade, TradeReturn, Zone } from "./strategy-types";

export function calculateRangeLevels(candles: Candle[]): RangeLevels | null {
  if (candles.length === 0) return null;
  const closes = candles.map((candle) => candle.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min;
  return {
    min,
    max,
    range,
    low20: min + range * 0.2,
    high80: min + range * 0.8
  };
}

export function getDecisionZone(price: number, levels: RangeLevels | null): Zone {
  if (!levels) return "neutral";
  if (price <= levels.low20) return "buy";
  if (price >= levels.high80) return "sell";
  return "neutral";
}

export function findCloseByDate(candles: Candle[], date: string) {
  return candles.find((candle) => candle.date === date)?.close;
}

function daysBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  return Math.max(1, (end - start) / (24 * 60 * 60 * 1000));
}

export function calculateTradeReturn(trade: Trade, currentPrice: number): TradeReturn {
  const resolvedClosePrice = trade.closePrice ?? currentPrice;
  const ratio = trade.direction === "buy"
    ? resolvedClosePrice / trade.openPrice
    : trade.openPrice / resolvedClosePrice;
  const endBaseAmount = ratio * trade.baseAmount;
  const profitBase = endBaseAmount - trade.baseAmount;
  const profitPct = (profitBase / trade.baseAmount) * 100;
  const endDate = trade.closeDate ?? new Date().toISOString().slice(0, 10);
  const durationDays = daysBetween(trade.openDate, endDate);
  return {
    trade,
    currentPrice,
    resolvedClosePrice,
    realized: Boolean(trade.closeDate && trade.closePrice),
    profitBase,
    profitPct,
    aprPct: profitPct * (365 / durationDays)
  };
}

export function formatPrice(value: number) {
  if (!Number.isFinite(value)) return "-";
  if (value >= 1) return value.toFixed(4);
  if (value >= 0.01) return value.toFixed(6);
  return value.toFixed(8);
}

export function formatBase(value: number, baseAsset: string) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(6)} ${baseAsset}`;
}
