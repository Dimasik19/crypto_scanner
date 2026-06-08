export type BaseAsset = "BTC" | "ETH";

export type QuoteAsset =
  | "ETH"
  | "BNB"
  | "TON"
  | "MNT"
  | "SUI"
  | "TAO"
  | "NEAR"
  | "SOL"
  | "XRP"
  | "DOGE"
  | "ADA"
  | "AVAX"
  | "DOT"
  | "LINK"
  | "MATIC"
  | "LTC";

export type Zone = "buy" | "neutral" | "sell";

export type ChartRange = "1Y" | "3Y" | "5Y" | "ALL";

export type TradeDirection = "buy" | "sell";

export interface Candle {
  time: number;
  date: string;
  close: number;
}

export interface RangeLevels {
  min: number;
  max: number;
  low20: number;
  high80: number;
  range: number;
}

export interface Trade {
  id: string;
  baseAsset: BaseAsset;
  quoteAsset: QuoteAsset;
  direction: TradeDirection;
  openDate: string;
  openPrice: number;
  baseAmount: number;
  closeDate?: string;
  closePrice?: number;
}

export interface TradeReturn {
  trade: Trade;
  currentPrice: number;
  resolvedClosePrice: number;
  realized: boolean;
  profitBase: number;
  profitPct: number;
  aprPct: number;
}
