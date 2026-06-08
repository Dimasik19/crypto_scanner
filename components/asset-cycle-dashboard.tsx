"use client";

import { Activity, AlertTriangle, BarChart3, Database, Download, Grid2X2, Loader2, Moon, RefreshCw, Save, ShieldCheck, Sun, TrendingDown, TrendingUp, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PriceChart } from "@/components/price-chart";
import { baseAssets, formatPair, getQuoteAssets } from "@/lib/pairs";
import { calculateRangeLevels, calculateTradeReturn, findCloseByDate, formatBase, formatPrice, getDecisionZone } from "@/lib/strategy";
import type { BaseAsset, Candle, ChartRange, QuoteAsset, Trade, TradeDirection, TradeReturn } from "@/lib/strategy-types";

const selectionKey = "asset-cycle-selection";
const tradesKey = "asset-cycle-trades";
const autoRefreshKey = "asset-cycle-auto-refresh";
const themeKey = "asset-cycle-theme";
const candleCache = new Map<string, Candle[]>();
const chartRanges: ChartRange[] = ["1Y", "3Y", "5Y", "ALL"];
type AppTheme = "dark" | "light";

interface SelectionState {
  baseAsset: BaseAsset;
  quoteAsset: QuoteAsset;
  range: ChartRange;
}

interface StoredSelectionState {
  baseAsset: BaseAsset;
  quoteAsset: QuoteAsset | "MANTLE";
  range?: ChartRange;
}

interface OhlcvPayload {
  candles?: Candle[];
  error?: string;
  source?: string;
  sourceSymbols?: string[];
}

interface HeatMapCell {
  pair: string;
  quoteAsset: QuoteAsset;
  currentPrice: number;
  averagePrice: number;
  deviationPct: number;
  zone: ReturnType<typeof getDecisionZone>;
  source: string;
}

type StoredTrade = Partial<Omit<Trade, "quoteAsset">> & {
  quoteAsset?: QuoteAsset | "MANTLE";
  buyDate?: string;
  buyPrice?: number;
  sellDate?: string;
  sellPrice?: number;
};

function normalizeStoredTrades(value: string): Trade[] {
  const parsed = JSON.parse(value) as StoredTrade[];
  const normalized: Trade[] = [];
  parsed.forEach((trade) => {
    const quoteAsset = trade.quoteAsset === "MANTLE" ? "MNT" : trade.quoteAsset;
    const openDate = trade.openDate ?? trade.buyDate;
    const openPrice = trade.openPrice ?? trade.buyPrice;
    if (!trade.id || !trade.baseAsset || !quoteAsset || !openDate || !openPrice || !trade.baseAmount) {
      return;
    }
    const nextTrade: Trade = {
        id: trade.id,
        baseAsset: trade.baseAsset,
        quoteAsset,
        direction: trade.direction ?? "buy",
        openDate,
        openPrice,
        baseAmount: trade.baseAmount
    };
    const closeDate = trade.closeDate ?? trade.sellDate;
    const closePrice = trade.closePrice ?? trade.sellPrice;
    if (closeDate) nextTrade.closeDate = closeDate;
    if (closePrice) nextTrade.closePrice = closePrice;
    normalized.push(nextTrade);
  });
  return normalized;
}

function pairCacheKey(baseAsset: BaseAsset, quoteAsset: QuoteAsset) {
  return `${baseAsset}/${quoteAsset}`;
}

async function fetchLatestPairPrice(baseAsset: BaseAsset, quoteAsset: QuoteAsset) {
  const response = await fetch(`/api/ohlcv?base=${baseAsset}&quote=${quoteAsset}&range=1Y&refresh=1`);
  const payload = (await response.json()) as OhlcvPayload;
  if (!response.ok || !payload.candles || payload.candles.length === 0) {
    return null;
  }
  return payload.candles.at(-1)?.close ?? null;
}

export function AssetCycleDashboard() {
  const [selection, setSelection] = useState<SelectionState>(() => {
    if (typeof window === "undefined") return { baseAsset: "BTC", quoteAsset: "NEAR", range: "3Y" };
    const storedSelection = localStorage.getItem(selectionKey);
    if (!storedSelection) return { baseAsset: "BTC", quoteAsset: "NEAR", range: "3Y" };
    const parsed = JSON.parse(storedSelection) as StoredSelectionState;
    const quoteAsset = parsed.quoteAsset === "MANTLE" ? "MNT" : parsed.quoteAsset;
    const normalized: SelectionState = { baseAsset: parsed.baseAsset, quoteAsset, range: parsed.range ?? "3Y" };
    return getQuoteAssets(parsed.baseAsset).includes(quoteAsset)
      ? normalized
      : { ...normalized, quoteAsset: getQuoteAssets(parsed.baseAsset)[0] };
  });
  const [candles, setCandles] = useState<Candle[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(autoRefreshKey) !== "false";
  });
  const [theme, setTheme] = useState<AppTheme>(() => {
    if (typeof window === "undefined") return "dark";
    return localStorage.getItem(themeKey) === "light" ? "light" : "dark";
  });
  const [heatMapOpen, setHeatMapOpen] = useState(false);
  const [heatMapBase, setHeatMapBase] = useState<BaseAsset>("BTC");
  const [trades, setTrades] = useState<Trade[]>(() => {
    if (typeof window === "undefined") return [];
    const storedTrades = localStorage.getItem(tradesKey);
    return storedTrades ? normalizeStoredTrades(storedTrades) : [];
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tradeForm, setTradeForm] = useState({
    direction: "buy" as TradeDirection,
    openDate: "",
    openPrice: "",
    baseAmount: "1"
  });

  const { baseAsset, quoteAsset, range } = selection;
  const pair = formatPair(quoteAsset, baseAsset);
  const availableQuoteAssets = useMemo(() => getQuoteAssets(baseAsset), [baseAsset]);
  const levels = useMemo(() => calculateRangeLevels(candles), [candles]);
  const currentPrice = candles.at(-1)?.close ?? 0;
  const zone = getDecisionZone(currentPrice, levels);
  const activeTrades = useMemo(() => trades.filter((trade) => trade.baseAsset === baseAsset && trade.quoteAsset === quoteAsset), [baseAsset, quoteAsset, trades]);
  const returns = useMemo<TradeReturn[]>(() => activeTrades.map((trade) => calculateTradeReturn(trade, currentPrice)), [activeTrades, currentPrice]);
  const totalProfit = returns.reduce((sum, item) => sum + item.profitBase, 0);
  const totalInvested = returns.reduce((sum, item) => sum + item.trade.baseAmount, 0);
  const firstPrice = candles[0]?.close ?? currentPrice;
  const holdProfit = totalInvested > 0 && firstPrice > 0 ? (currentPrice / firstPrice) * totalInvested - totalInvested : 0;

  const loadCandles = useCallback(async (base: BaseAsset, quote: QuoteAsset, nextRange: ChartRange, forceRefresh = false) => {
    const key = `cross-usdt:${quote}/${base}:${nextRange}`;
    const cached = candleCache.get(key);
    if (cached && !forceRefresh) {
      setCandles(cached);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/ohlcv?base=${base}&quote=${quote}&range=${nextRange}${forceRefresh ? "&refresh=1" : ""}`);
      const payload = (await response.json()) as OhlcvPayload;
      if (!response.ok || !payload.candles) {
        throw new Error(payload.error ?? "Не удалось получить исторические свечи");
      }
      candleCache.set(key, payload.candles);
      setCandles(payload.candles);
      setLastUpdatedAt(new Date());
    } catch (requestError) {
      setCandles([]);
      setError(requestError instanceof Error ? requestError.message : "Не удалось получить данные");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(selectionKey, JSON.stringify({ baseAsset, quoteAsset, range }));
    queueMicrotask(() => void loadCandles(baseAsset, quoteAsset, range));
  }, [baseAsset, quoteAsset, range, loadCandles]);

  useEffect(() => {
    if (!autoRefreshEnabled) return;
    const interval = window.setInterval(() => {
      void loadCandles(baseAsset, quoteAsset, range, true);
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [autoRefreshEnabled, baseAsset, quoteAsset, range, loadCandles]);

  useEffect(() => {
    localStorage.setItem(tradesKey, JSON.stringify(trades));
  }, [trades]);

  useEffect(() => {
    localStorage.setItem(autoRefreshKey, String(autoRefreshEnabled));
  }, [autoRefreshEnabled]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(themeKey, theme);
  }, [theme]);

  useEffect(() => {
    if (candles.length === 0) return;
    const latest = candles.at(-1);
    queueMicrotask(() => {
      setTradeForm((form) => ({
        ...form,
        openDate: form.openDate || latest?.date || "",
        openPrice: form.openPrice || formatPrice(latest?.close ?? 0)
      }));
    });
  }, [candles]);

  function fillPrice(date: string) {
    const close = findCloseByDate(candles, date);
    if (!close) return;
    setTradeForm((form) => ({ ...form, openPrice: formatPrice(close) }));
  }

  function addTrade() {
    const openPrice = Number(tradeForm.openPrice);
    const baseAmount = Number(tradeForm.baseAmount);
    if (!tradeForm.openDate || !openPrice || !baseAmount) return;

    const trade: Trade = {
      id: crypto.randomUUID(),
      baseAsset,
      quoteAsset,
      direction: tradeForm.direction,
      openDate: tradeForm.openDate,
      openPrice,
      baseAmount
    };

    setTrades((items) => [trade, ...items]);
    setTradeForm({
      direction: tradeForm.direction,
      openDate: candles.at(-1)?.date ?? "",
      openPrice: formatPrice(currentPrice || 0),
      baseAmount: "1"
    });
  }

  function setTradeClose(id: string, closeDate: string) {
    const today = new Date().toISOString().slice(0, 10);
    if (closeDate > today) return;
    const closePrice = closeDate ? findCloseByDate(candles, closeDate) : undefined;
    setTrades((items) => items.map((item) => {
      if (item.id !== id) return item;
      return {
        ...item,
        closeDate: closeDate || undefined,
        closePrice
      };
    }));
  }

  function removeTrade(id: string) {
    setTrades((items) => items.filter((item) => item.id !== id));
  }

  function openHeatMap() {
    setHeatMapBase(baseAsset);
    setHeatMapOpen(true);
  }

  async function exportTrades(scope: "pair" | "all") {
    const latestPrices = new Map<string, number>();

    if (scope === "all") {
      const openPairs = Array.from(new Set(
        trades
          .filter((trade) => !trade.closePrice)
          .map((trade) => pairCacheKey(trade.baseAsset, trade.quoteAsset))
      ));

      await Promise.all(openPairs.map(async (key) => {
        const trade = trades.find((item) => pairCacheKey(item.baseAsset, item.quoteAsset) === key);
        if (!trade) return;
        const latestPrice = trade.baseAsset === baseAsset && trade.quoteAsset === quoteAsset
          ? currentPrice
          : await fetchLatestPairPrice(trade.baseAsset, trade.quoteAsset);
        if (latestPrice) latestPrices.set(key, latestPrice);
      }));
    }

    const rows = scope === "pair"
      ? returns.map((item) => buildExportRow(item, baseAsset, pair))
      : trades.map((trade) => {
        const tradePair = formatPair(trade.quoteAsset, trade.baseAsset);
        const exportPrice = trade.closePrice ?? latestPrices.get(pairCacheKey(trade.baseAsset, trade.quoteAsset));
        const tradeReturn = exportPrice ? calculateTradeReturn(trade, exportPrice) : null;
        return tradeReturn ? buildExportRow(tradeReturn, trade.baseAsset, tradePair) : buildRawExportRow(trade, tradePair);
      });

    const XLSX = await import("xlsx");
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, scope === "pair" ? "Current pair" : "All trades");
    XLSX.writeFile(workbook, `value-growth-${scope}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <main className="terminal-grid min-h-screen px-4 py-4 text-slate-100 md:px-6">
      <div className="mx-auto flex max-w-[1680px] flex-col gap-4">
        <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border border-grid bg-ink/92 px-4 py-3 shadow-terminal">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border border-cyan/50 bg-cyan/10 text-cyan">
              <BarChart3 size={22} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-normal text-white">Value Growth Tool</h1>
              <p className="font-mono text-xs text-slate-400">asset accumulation strategy · range 20/80 · daily close</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip icon={<Database size={14} />} label="Binance OHLCV" tone="cyan" />
            <button
              className={`flex h-9 items-center border px-3 font-mono text-xs ${autoRefreshEnabled ? "border-lime/60 bg-lime/10 text-lime" : "border-grid bg-panel text-slate-400 hover:border-cyan/60"}`}
              onClick={() => setAutoRefreshEnabled((enabled) => !enabled)}
            >
              Auto refresh {autoRefreshEnabled ? "on" : "off"}
            </button>
            <StatusChip icon={<ShieldCheck size={14} />} label="local trades" tone="lime" />
            <button
              className="flex h-9 items-center gap-2 border border-grid bg-panel2 px-3 font-mono text-xs text-slate-200 hover:border-cyan/70"
              onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Moon size={14} /> : <Sun size={14} />}
              {theme === "dark" ? "Dark" : "Light"}
            </button>
          </div>
        </header>

        <section className="grid min-w-0 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="flex min-w-0 flex-col gap-4">
            <Panel
              title="Market"
              icon={<Activity size={16} />}
              action={(
                <button className="flex h-8 items-center gap-2 border border-grid bg-ink px-2 font-mono text-xs text-slate-200 hover:border-cyan/70" onClick={openHeatMap}>
                  <Grid2X2 size={14} />
                  HeatMap
                </button>
              )}
            >
              <div className="mb-4">
                <div className="mb-2 text-xs text-slate-400">Base asset</div>
                <div className="grid grid-cols-2 border border-grid bg-ink p-1">
                  {baseAssets.map((asset) => (
                    <button
                      key={asset}
                      className={`h-10 font-mono text-sm ${baseAsset === asset ? "bg-cyan text-ink" : "text-slate-300 hover:bg-panel2"}`}
                      onClick={() => setSelection((current) => {
                        const nextQuoteAssets = getQuoteAssets(asset);
                        return {
                          baseAsset: asset,
                          quoteAsset: nextQuoteAssets.includes(current.quoteAsset) ? current.quoteAsset : nextQuoteAssets[0],
                          range: current.range
                        };
                      })}
                    >
                      {asset}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block text-xs text-slate-400">
                Pair
                <select className="mt-1 h-11 w-full border border-grid bg-ink px-3 text-sm text-white" value={quoteAsset} onChange={(event) => setSelection((current) => ({ ...current, quoteAsset: event.target.value as QuoteAsset }))}>
                  {availableQuoteAssets.map((asset) => (
                    <option key={asset} value={asset}>
                      {formatPair(asset, baseAsset)}
                    </option>
                  ))}
                </select>
              </label>
                <button className="mt-3 flex h-10 w-full items-center justify-center gap-2 border border-grid bg-panel2 text-sm text-slate-200 hover:border-cyan/70" onClick={() => loadCandles(baseAsset, quoteAsset, range, true)}>
                <RefreshCw size={15} />
                Refresh candles
              </button>
            </Panel>

            <Panel title="Decision" icon={<TrendingUp size={16} />}>
              <DecisionBlock zone={zone} pair={pair} price={currentPrice} levels={levels} lastUpdatedAt={lastUpdatedAt} />
            </Panel>

            <Panel title="Add Trade" icon={<Save size={16} />}>
              <div className="grid gap-3">
                <div>
                  <div className="mb-2 text-xs text-slate-400">Direction</div>
                  <div className="grid grid-cols-2 border border-grid bg-ink p-1">
                    <button className={`h-10 font-mono text-sm ${tradeForm.direction === "buy" ? "bg-lime text-ink" : "text-slate-300 hover:bg-panel2"}`} onClick={() => setTradeForm((form) => ({ ...form, direction: "buy" }))}>
                      Buy base
                    </button>
                    <button className={`h-10 font-mono text-sm ${tradeForm.direction === "sell" ? "bg-danger text-ink" : "text-slate-300 hover:bg-panel2"}`} onClick={() => setTradeForm((form) => ({ ...form, direction: "sell" }))}>
                      Sell base
                    </button>
                  </div>
                </div>
                <label className="text-xs text-slate-400">
                  Open date
                  <input className="mt-1 h-10 w-full border border-grid bg-ink px-3 text-sm text-white" type="date" value={tradeForm.openDate} onChange={(event) => {
                    setTradeForm((form) => ({ ...form, openDate: event.target.value }));
                    fillPrice(event.target.value);
                  }} />
                </label>
                <label className="text-xs text-slate-400">
                  Open price ({pair})
                  <input className="mt-1 h-10 w-full border border-grid bg-ink px-3 font-mono text-sm text-white" value={tradeForm.openPrice} onChange={(event) => setTradeForm((form) => ({ ...form, openPrice: event.target.value }))} />
                </label>
                <label className="text-xs text-slate-400">
                  Base amount ({baseAsset})
                  <input className="mt-1 h-10 w-full border border-grid bg-ink px-3 font-mono text-sm text-white" value={tradeForm.baseAmount} onChange={(event) => setTradeForm((form) => ({ ...form, baseAmount: event.target.value }))} />
                </label>
                <button className="flex h-11 items-center justify-center gap-2 border border-cyan/70 bg-cyan text-sm font-semibold text-ink hover:bg-cyan/90" onClick={addTrade}>
                  <Save size={16} />
                  Open trade
                </button>
              </div>
            </Panel>
          </aside>

          <div className="grid min-w-0 gap-4">
            <section className="min-w-0 border border-grid bg-panel/94">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-grid px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase text-white">{pair} Closing Price</h2>
                  <p className="font-mono text-xs text-slate-500">If price is below green line buy base asset. Above red line sell base asset.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="grid grid-cols-4 border border-grid bg-ink p-1">
                    {chartRanges.map((item) => (
                      <button
                        key={item}
                        className={`h-8 min-w-14 px-3 font-mono text-xs ${range === item ? "bg-cyan text-ink" : "text-slate-300 hover:bg-panel2"}`}
                        onClick={() => setSelection((current) => ({ ...current, range: item }))}
                      >
                        {item === "ALL" ? "All" : item}
                      </button>
                    ))}
                  </div>
                  <div className="font-mono text-xs text-slate-400">{candles.length} daily candles</div>
                </div>
              </div>
              {loading ? <StateMessage text="Loading Binance daily candles..." /> : error ? <StateMessage text={error} error /> : candles.length === 0 ? <StateMessage text="Нет данных за последние 3 года." error /> : <PriceChart candles={candles} levels={levels} trades={activeTrades} pair={pair} theme={theme} />}
            </section>

            <section className="grid items-start gap-4 lg:grid-cols-3">
              <Metric label="Total strategy change" value={formatBase(totalProfit, baseAsset)} tone={totalProfit >= 0 ? "lime" : "danger"} sub={`${returns.length} transactions, realized + open`} />
              <Metric label="Hold only baseline" value={formatBase(holdProfit, baseAsset)} tone={holdProfit >= 0 ? "lime" : "danger"} sub="same base amount from first candle" />
              <Metric label="Strategy vs hold" value={formatBase(totalProfit - holdProfit, baseAsset)} tone={totalProfit - holdProfit >= 0 ? "cyan" : "amber"} sub="relative capital delta" />
            </section>

            <TransactionsTable returns={returns} baseAsset={baseAsset} pair={pair} onRemove={removeTrade} onCloseDateChange={setTradeClose} onExport={exportTrades} />
          </div>
        </section>
      </div>
      <HeatMapDrawer
        open={heatMapOpen}
        baseAsset={heatMapBase}
        onClose={() => setHeatMapOpen(false)}
        onSelectPair={(nextBaseAsset, nextQuoteAsset) => {
          setSelection((current) => ({ ...current, baseAsset: nextBaseAsset, quoteAsset: nextQuoteAsset }));
          setHeatMapOpen(false);
        }}
      />
    </main>
  );
}

function buildExportRow(item: TradeReturn, baseAsset: BaseAsset, pair: string) {
  return {
    Pair: pair,
    Direction: item.trade.direction === "buy" ? "Buy base" : "Sell base",
    "Open date": item.trade.openDate,
    "Open price": item.trade.openPrice,
    "Base amount": item.trade.baseAmount,
    "Base asset": baseAsset,
    "Close date": item.trade.closeDate ?? "",
    "Close/current price": item.resolvedClosePrice,
    Status: item.realized ? "Closed" : "Open",
    "Return base": item.profitBase,
    "Return %": item.profitPct,
    "APR %": item.aprPct
  };
}

function buildRawExportRow(trade: Trade, pair: string) {
  return {
    Pair: pair,
    Direction: trade.direction === "buy" ? "Buy base" : "Sell base",
    "Open date": trade.openDate,
    "Open price": trade.openPrice,
    "Base amount": trade.baseAmount,
    "Base asset": trade.baseAsset,
    "Close date": trade.closeDate ?? "",
    "Close/current price": trade.closePrice ?? "",
    Status: trade.closeDate ? "Closed" : "Open",
    "Return base": "",
    "Return %": "",
    "APR %": ""
  };
}

function Panel({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border border-grid bg-panel/94 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase text-white">
          {icon}
          {title}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function HeatMapDrawer({
  open,
  baseAsset,
  onClose,
  onSelectPair
}: {
  open: boolean;
  baseAsset: BaseAsset;
  onClose: () => void;
  onSelectPair: (baseAsset: BaseAsset, quoteAsset: QuoteAsset) => void;
}) {
  const [range, setRange] = useState<ChartRange>("3Y");
  const [cells, setCells] = useState<HeatMapCell[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [failedCount, setFailedCount] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function loadHeatMap() {
      setLoading(true);
      setError(null);
      setFailedCount(0);
      const requestId = Date.now();

      try {
        const results = await Promise.all(getQuoteAssets(baseAsset).map(async (quoteAsset) => {
          try {
            const response = await fetch(`/api/ohlcv?base=${baseAsset}&quote=${quoteAsset}&range=${range}&refresh=1&t=${requestId}`, {
              cache: "no-store"
            });
            const payload = (await response.json()) as OhlcvPayload;
            if (!response.ok || !payload.candles || payload.candles.length === 0) return null;

            const currentPrice = payload.candles.at(-1)?.close ?? 0;
            const averagePrice = payload.candles.reduce((sum, candle) => sum + candle.close, 0) / payload.candles.length;
            const levels = calculateRangeLevels(payload.candles);

            return {
              pair: formatPair(quoteAsset, baseAsset),
              quoteAsset,
              currentPrice,
              averagePrice,
              deviationPct: averagePrice > 0 ? ((currentPrice - averagePrice) / averagePrice) * 100 : 0,
              zone: getDecisionZone(currentPrice, levels),
              source: payload.source ?? "market-data"
            };
          } catch {
            return null;
          }
        }));

        if (!cancelled) {
          const nextCells = results.filter((cell): cell is HeatMapCell => cell !== null);
          setCells(nextCells);
          setFailedCount(results.length - nextCells.length);
          setLastUpdatedAt(new Date());
          if (nextCells.length === 0) setError("Failed to load heat map");
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : "Failed to load heat map");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadHeatMap();
    return () => {
      cancelled = true;
    };
  }, [baseAsset, open, range, refreshNonce]);

  return (
    <>
      {open ? <button className="fixed inset-0 z-40 bg-black/40 backdrop-blur-md" aria-label="Close heat map overlay" onClick={onClose} /> : null}
      <aside className={`fixed right-0 top-0 z-50 h-screen w-full max-w-[1120px] border-l border-grid bg-ink shadow-terminal transition-transform duration-300 xl:w-2/3 ${open ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex h-full flex-col">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-grid px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold uppercase text-white">{baseAsset} HeatMap</h2>
              <p className="font-mono text-xs text-slate-500">
                {lastUpdatedAt ? `Updated ${lastUpdatedAt.toLocaleTimeString()}` : "Current base price in quote asset units"}
                {failedCount > 0 ? ` · ${failedCount} pairs skipped` : ""}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="grid grid-cols-3 border border-grid bg-panel p-1">
                {(["1Y", "3Y", "5Y"] as ChartRange[]).map((item) => (
                  <button
                    key={item}
                    className={`h-8 min-w-14 px-3 font-mono text-xs ${range === item ? "bg-cyan text-ink" : "text-slate-300 hover:bg-panel2"}`}
                    onClick={() => setRange(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <button
                className="flex h-9 w-9 items-center justify-center border border-grid text-slate-300 hover:border-cyan/70 hover:text-cyan disabled:opacity-50"
                onClick={() => setRefreshNonce((value) => value + 1)}
                disabled={loading}
                aria-label="Refresh heat map"
              >
                <RefreshCw className={loading ? "animate-spin" : ""} size={16} />
              </button>
              <button className="flex h-9 w-9 items-center justify-center border border-grid text-slate-300 hover:border-danger/70 hover:text-danger" onClick={onClose} aria-label="Close heat map">
                <X size={17} />
              </button>
            </div>
          </header>

          <div className="scrollbar-thin flex-1 overflow-auto p-5">
            {loading ? (
              <div className="flex h-80 items-center justify-center gap-2 font-mono text-sm text-slate-400">
                <Loader2 className="animate-spin" size={18} />
                Loading heat map...
              </div>
            ) : error ? (
              <div className="flex h-80 items-center justify-center text-center font-mono text-sm text-danger">{error}</div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {cells.map((cell) => (
                  <HeatMapCard key={cell.pair} cell={cell} onSelect={() => onSelectPair(baseAsset, cell.quoteAsset)} />
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function HeatMapCard({ cell, onSelect }: { cell: HeatMapCell; onSelect: () => void }) {
  const tone = cell.zone === "buy"
    ? { label: "BUY BASE", border: "border-lime/60", bg: "bg-lime/10", text: "text-lime" }
    : cell.zone === "sell"
      ? { label: "SELL BASE", border: "border-danger/60", bg: "bg-danger/10", text: "text-danger" }
      : { label: "NEUTRAL", border: "border-amber/60", bg: "bg-amber/10", text: "text-amber" };

  return (
    <button className={`border p-4 text-left transition hover:border-cyan/70 ${tone.border} ${tone.bg}`} onClick={onSelect}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="font-mono text-xs text-slate-400">{cell.pair}</div>
        <div className={`font-mono text-xs font-semibold ${tone.text}`}>{tone.label}</div>
      </div>
      <div className="font-mono text-3xl font-semibold text-white">{formatPrice(cell.currentPrice)}</div>
      <div className={`mt-3 font-mono text-2xl font-semibold ${tone.text}`}>
        {cell.deviationPct > 0 ? "+" : ""}{cell.deviationPct.toFixed(2)}%
      </div>
      <div className="mt-2 font-mono text-xs text-slate-500">vs average {formatPrice(cell.averagePrice)}</div>
      <div className="mt-3 font-mono text-[11px] uppercase text-slate-500">{cell.source}</div>
    </button>
  );
}

function StatusChip({ icon, label, tone }: { icon: React.ReactNode; label: string; tone: "cyan" | "lime" }) {
  const color = tone === "cyan" ? "border-cyan/50 text-cyan bg-cyan/10" : "border-lime/50 text-lime bg-lime/10";
  return <span className={`flex h-9 items-center gap-2 border px-3 font-mono text-xs ${color}`}>{icon}{label}</span>;
}

function DecisionBlock({ zone, pair, price, levels, lastUpdatedAt }: { zone: string; pair: string; price: number; levels: ReturnType<typeof calculateRangeLevels>; lastUpdatedAt: Date | null }) {
  const state = zone === "buy" ? { label: "BUY BASE", icon: <TrendingUp size={18} />, color: "text-lime", bg: "bg-lime/10 border-lime/50" } : zone === "sell" ? { label: "SELL BASE", icon: <TrendingDown size={18} />, color: "text-danger", bg: "bg-danger/10 border-danger/50" } : { label: "NEUTRAL", icon: <AlertTriangle size={18} />, color: "text-amber", bg: "bg-amber/10 border-amber/50" };
  return (
    <div className={`border p-4 ${state.bg}`}>
      <div className={`mb-3 flex items-center gap-2 text-lg font-semibold ${state.color}`}>{state.icon}{state.label}</div>
      <div className="font-mono text-xs text-slate-400">{pair}</div>
      <div className="mt-1 font-mono text-2xl text-white">{formatPrice(price)}</div>
      <div className="mt-4 grid gap-2 font-mono text-xs text-slate-300">
        <div className="flex justify-between"><span>20% line</span><span className="text-lime">{levels ? formatPrice(levels.low20) : "-"}</span></div>
        <div className="flex justify-between"><span>80% line</span><span className="text-danger">{levels ? formatPrice(levels.high80) : "-"}</span></div>
        <div className="flex justify-between"><span>Range</span><span>{levels ? `${formatPrice(levels.min)} - ${formatPrice(levels.max)}` : "-"}</span></div>
        <div className="flex justify-between"><span>Updated</span><span>{lastUpdatedAt ? lastUpdatedAt.toLocaleString() : "-"}</span></div>
      </div>
    </div>
  );
}

function StateMessage({ text, error = false }: { text: string; error?: boolean }) {
  return <div className={`flex h-[520px] items-center justify-center p-6 text-center font-mono text-sm ${error ? "text-danger" : "text-slate-400"}`}>{text}</div>;
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "lime" | "danger" | "cyan" | "amber" }) {
  const color = tone === "lime" ? "text-lime" : tone === "danger" ? "text-danger" : tone === "cyan" ? "text-cyan" : "text-amber";
  return (
    <div className="h-fit border border-grid bg-panel/94 px-4 py-3">
      <div className="mb-1 text-xs uppercase text-slate-400">{label}</div>
      <div className={`font-mono text-2xl font-semibold leading-tight ${color}`}>{value}</div>
      <div className="mt-1 font-mono text-xs leading-tight text-slate-500">{sub}</div>
    </div>
  );
}

function TransactionsTable({
  returns,
  baseAsset,
  pair,
  onRemove,
  onCloseDateChange,
  onExport
}: {
  returns: TradeReturn[];
  baseAsset: BaseAsset;
  pair: string;
  onRemove: (id: string) => void;
  onCloseDateChange: (id: string, closeDate: string) => void;
  onExport: (scope: "pair" | "all") => void;
}) {
  return (
    <section className="min-w-0 border border-grid bg-panel/94">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-grid px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase text-white">Transactions</h2>
          <p className="font-mono text-xs text-slate-500">PnL is calculated in {baseAsset}, not USD.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="flex h-9 items-center gap-2 border border-grid bg-ink px-3 text-xs text-slate-200 hover:border-cyan/70" onClick={() => onExport("pair")}>
            <Download size={14} />
            Export pair
          </button>
          <button className="flex h-9 items-center gap-2 border border-grid bg-ink px-3 text-xs text-slate-200 hover:border-cyan/70" onClick={() => onExport("all")}>
            <Download size={14} />
            Export all
          </button>
        </div>
      </div>
      <div className="scrollbar-thin overflow-auto">
        <div className="grid min-w-[1280px] grid-cols-[110px_120px_140px_150px_150px_150px_minmax(300px,1fr)_90px] border-b border-grid bg-ink/60 px-4 py-2 font-mono text-[11px] uppercase text-slate-500">
          <span>Direction</span>
          <span>Open date</span>
          <span>Open price</span>
          <span>Base amount</span>
          <span>Close date</span>
          <span>Close/current</span>
          <span>Return</span>
          <span />
        </div>
        {returns.length === 0 ? (
          <div className="px-4 py-8 text-sm text-slate-500">No transactions for {pair} yet.</div>
        ) : (
          returns.map((item) => (
            <div key={item.trade.id} className="grid min-w-[1280px] grid-cols-[110px_120px_140px_150px_150px_150px_minmax(300px,1fr)_90px] items-center gap-2 border-b border-grid/80 px-4 py-3 font-mono text-sm">
              <span className={item.trade.direction === "buy" ? "text-lime" : "text-danger"}>{item.trade.direction === "buy" ? "Buy base" : "Sell base"}</span>
              <span className="text-slate-200">{item.trade.openDate}</span>
              <span>{formatPrice(item.trade.openPrice)}</span>
              <span>{item.trade.baseAmount.toFixed(6)} {baseAsset}</span>
              <input
                className="h-9 border border-grid bg-ink px-2 text-xs text-white"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={item.trade.closeDate ?? ""}
                onChange={(event) => onCloseDateChange(item.trade.id, event.target.value)}
              />
              <span>{formatPrice(item.resolvedClosePrice)} <span className="text-xs text-slate-500">{item.realized ? "closed" : "live"}</span></span>
              <span className={`whitespace-nowrap ${item.profitBase >= 0 ? "text-lime" : "text-danger"}`}>
                {formatBase(item.profitBase, baseAsset)} ({item.profitPct.toFixed(2)}%, APR {item.aprPct.toFixed(2)}%)
              </span>
              <button className="justify-self-end border border-grid px-3 py-1 text-xs text-slate-300 hover:border-danger/70 hover:text-danger" onClick={() => onRemove(item.trade.id)}>Delete</button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
