import { NextResponse } from "next/server";
import { formatPair, toUsdtSymbol } from "@/lib/pairs";
import type { BaseAsset, Candle, ChartRange, QuoteAsset } from "@/lib/strategy-types";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BATCHES = 12;
const cache = new Map<string, { expires: number; candles: Candle[] }>();

type BinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string
];

type BybitKline = [
  string,
  string,
  string,
  string,
  string,
  string,
  string
];

type BybitKlineResponse = {
  retCode: number;
  retMsg: string;
  result?: {
    list?: BybitKline[];
  };
};

function getStartTime(range: ChartRange, endTime: number) {
  if (range === "1Y") return endTime - 365 * DAY_MS;
  if (range === "3Y") return endTime - 365 * 3 * DAY_MS;
  if (range === "5Y") return endTime - 365 * 5 * DAY_MS;
  return 0;
}

async function fetchKlines(symbol: string, startTime: number, endTime: number) {
  const url = new URL("https://api.binance.com/api/v3/klines");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("startTime", String(startTime));
  url.searchParams.set("endTime", String(endTime));
  url.searchParams.set("limit", "1000");

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Binance returned ${response.status}`);
  }

  return (await response.json()) as BinanceKline[];
}

async function fetchDailyCandles(symbol: string, range: ChartRange, endTime: number) {
  let nextStart = getStartTime(range, endTime);
  const merged: BinanceKline[] = [];

  for (let batch = 0; batch < MAX_BATCHES && nextStart < endTime; batch += 1) {
    const klines = await fetchKlines(symbol, nextStart, endTime);
    if (klines.length === 0) break;
    merged.push(...klines);
    const lastOpenTime = klines[klines.length - 1][0];
    nextStart = lastOpenTime + DAY_MS;
    if (klines.length < 1000) break;
  }

  const seen = new Set<number>();
  return merged
    .filter((item) => {
      if (seen.has(item[0])) return false;
      seen.add(item[0]);
      return true;
    })
    .map((item) => ({
      time: Math.floor(item[0] / 1000),
      date: new Date(item[0]).toISOString().slice(0, 10),
      close: Number(item[4])
    }))
    .filter((item) => Number.isFinite(item.close) && item.close > 0);
}

async function fetchBybitKlines(symbol: string, startTime: number, endTime: number) {
  const url = new URL("https://api.bybit.com/v5/market/kline");
  url.searchParams.set("category", "spot");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "D");
  url.searchParams.set("start", String(startTime));
  url.searchParams.set("end", String(endTime));
  url.searchParams.set("limit", "1000");

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Bybit returned ${response.status}`);
  }

  const payload = (await response.json()) as BybitKlineResponse;
  if (payload.retCode !== 0) {
    throw new Error(`Bybit returned ${payload.retCode}: ${payload.retMsg}`);
  }

  return payload.result?.list ?? [];
}

async function fetchBybitDailyCandles(symbol: string, range: ChartRange, endTime: number) {
  const startTime = getStartTime(range, endTime);
  let nextEnd = endTime;
  const merged: BybitKline[] = [];

  for (let batch = 0; batch < MAX_BATCHES && nextEnd > startTime; batch += 1) {
    const klines = await fetchBybitKlines(symbol, startTime, nextEnd);
    if (klines.length === 0) break;
    merged.push(...klines);

    const oldestOpenTime = Math.min(...klines.map((item) => Number(item[0])));
    if (!Number.isFinite(oldestOpenTime) || oldestOpenTime <= startTime || klines.length < 1000) break;
    nextEnd = oldestOpenTime - DAY_MS;
  }

  const seen = new Set<number>();
  return merged
    .filter((item) => {
      const timestamp = Number(item[0]);
      if (!Number.isFinite(timestamp) || seen.has(timestamp)) return false;
      seen.add(timestamp);
      return true;
    })
    .map((item) => {
      const timestamp = Number(item[0]);
      return {
        time: Math.floor(timestamp / 1000),
        date: new Date(timestamp).toISOString().slice(0, 10),
        close: Number(item[4])
      };
    })
    .filter((item) => Number.isFinite(item.close) && item.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchUsdCandles(asset: BaseAsset | QuoteAsset, range: ChartRange, endTime: number) {
  if (asset === "MNT") {
    return fetchBybitDailyCandles("MNTUSDT", range, endTime);
  }
  return fetchDailyCandles(toUsdtSymbol(asset), range, endTime);
}

function getSourceSymbol(asset: BaseAsset | QuoteAsset) {
  return asset === "MNT" ? "bybit:MNTUSDT" : toUsdtSymbol(asset);
}

function buildCrossCandles(baseCandles: Candle[], quoteCandles: Candle[]) {
  const quoteByDate = new Map(quoteCandles.map((candle) => [candle.date, candle.close]));
  return baseCandles
    .map((baseCandle) => {
      const quoteClose = quoteByDate.get(baseCandle.date);
      if (!quoteClose) return null;
      return {
        time: baseCandle.time,
        date: baseCandle.date,
        close: baseCandle.close / quoteClose
      };
    })
    .filter((item): item is Candle => item !== null && Number.isFinite(item.close) && item.close > 0);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const base = searchParams.get("base") as BaseAsset | null;
  const quote = searchParams.get("quote") as QuoteAsset | null;
  const range = (searchParams.get("range") ?? "3Y") as ChartRange;
  const forceRefresh = searchParams.get("refresh") === "1";

  if (!base || !quote) {
    return NextResponse.json({ error: "base and quote are required" }, { status: 400 });
  }
  if (!["1Y", "3Y", "5Y", "ALL"].includes(range)) {
    return NextResponse.json({ error: "range must be one of 1Y, 3Y, 5Y, ALL" }, { status: 400 });
  }

  const key = formatPair(quote, base);
  const baseSymbol = getSourceSymbol(base);
  const quoteSymbol = getSourceSymbol(quote);
  const cacheKey = `cross-usdt:${key}:${range}`;
  const source = quote === "MNT" ? "mixed-usd-cross" : "binance-usdt-cross";
  const cached = cache.get(cacheKey);
  if (!forceRefresh && cached && cached.expires > Date.now()) {
    return NextResponse.json({ pair: key, sourceSymbols: [baseSymbol, quoteSymbol], range, source, cached: true, candles: cached.candles });
  }

  try {
    const endTime = Date.now();
    const [baseCandles, quoteCandles] = await Promise.all([
      fetchUsdCandles(base, range, endTime),
      fetchUsdCandles(quote, range, endTime)
    ]);
    const candles = buildCrossCandles(baseCandles, quoteCandles);

    if (candles.length === 0) {
      return NextResponse.json({ error: `No daily USD-cross candles for ${key}`, pair: key, sourceSymbols: [baseSymbol, quoteSymbol] }, { status: 404 });
    }

    cache.set(cacheKey, { expires: Date.now() + 10 * 60 * 1000, candles });
    return NextResponse.json({ pair: key, sourceSymbols: [baseSymbol, quoteSymbol], range, source, cached: false, candles });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Binance API error";
    return NextResponse.json({ error: message, pair: key, sourceSymbols: [baseSymbol, quoteSymbol] }, { status: 502 });
  }
}
