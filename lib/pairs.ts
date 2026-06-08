import type { BaseAsset, QuoteAsset } from "./strategy-types";

export const baseAssets: BaseAsset[] = ["BTC", "ETH"];

export const altQuoteAssets: QuoteAsset[] = ["ADA", "BNB", "DOGE", "LINK", "LTC", "MNT", "NEAR", "SOL", "SUI", "TAO", "TON", "XRP"];

export function getQuoteAssets(baseAsset: BaseAsset): QuoteAsset[] {
  return baseAsset === "BTC" ? ["ETH", ...altQuoteAssets] : altQuoteAssets;
}

export function formatPair(quoteAsset: QuoteAsset, baseAsset: BaseAsset) {
  return `${baseAsset}/${quoteAsset}`;
}

export function toUsdtSymbol(asset: BaseAsset | QuoteAsset) {
  return `${asset}USDT`;
}

export function toBinanceSymbol(quoteAsset: QuoteAsset, baseAsset: BaseAsset) {
  return `${quoteAsset}${baseAsset}`;
}
