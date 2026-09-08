import type { MarketInfo, Mode } from "@/lib/types";
import { aliasBase, normalizeToken, PREFERRED_QUOTE_ASSET } from "@/lib/market/aliases";
import { marketInfoForDemoSeeds } from "@/lib/demo/data";

/**
 * Dynamic market catalog built from Binance instrument metadata.
 *
 * RiskLens never maintains a hardcoded supported-coins list. The catalog
 * is the single authority for which pairs exist: symbol resolution,
 * status checks, precisions and order filters all come from here.
 *
 * - Live: fetched from Binance's public `exchangeInfo` endpoint (public
 *   market data — no API key involved) and cached in-process.
 * - Demo: a deterministic offline seed for well-known majors is used.
 *   The rehearsal environment must be reproducible and never depend on
 *   network state — Demo Mode never contacts the network.
 */

export interface BinanceExchangeInfoSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  baseAssetPrecision?: number;
  quoteAssetPrecision?: number;
  filters?: Array<{
    filterType?: string;
    minQty?: string | number;
    maxQty?: string | number;
    stepSize?: string | number;
    minNotional?: string | number;
    tickSize?: string | number;
  }>;
}

const BINANCE_PUBLIC_EXCHANGE_INFO = "https://api.binance.com/api/v3/exchangeInfo";

export class MarketCatalog {
  private readonly bySymbol = new Map<string, MarketInfo>();

  constructor(entries: MarketInfo[]) {
    for (const entry of entries) this.bySymbol.set(entry.symbol, entry);
  }

  static fromList(entries: MarketInfo[]): MarketCatalog {
    return new MarketCatalog(entries);
  }

  static fromExchangeInfoSymbols(symbols: BinanceExchangeInfoSymbol[]): MarketCatalog {
    return new MarketCatalog(symbols.map((s) => exchangeInfoToMarketInfo(s)));
  }

  info(symbol: string): MarketInfo | null {
    return this.bySymbol.get(symbol.toUpperCase()) ?? null;
  }

  has(symbol: string): boolean {
    return this.bySymbol.has(symbol.toUpperCase());
  }

  symbols(): string[] {
    return [...this.bySymbol.keys()];
  }

  entries(): MarketInfo[] {
    return [...this.bySymbol.values()];
  }

  /**
   * Resolves a user token ("SOL", "BTC/USDT", "bitcoin", "XRPUSDT") to a
   * catalog pair, preferring the configured default quote asset unless the
   * user explicitly named a quote.
   */
  resolve(token: string, preferredQuote: string = PREFERRED_QUOTE_ASSET): MarketInfo | null {
    const direct = this.bySymbol.get(token.trim().toUpperCase());
    if (direct) return direct;

    const normalized = normalizeToken(token);
    if (!normalized.base) return null;

    const candidates =
      normalized.quote !== null && normalized.quote !== undefined
        ? [`${normalized.base}${normalized.quote}`]
        : [`${normalized.base}${preferredQuote}`];

    for (const candidate of candidates) {
      const found = this.bySymbol.get(candidate);
      if (found) return found;
    }
    return null;
  }

  /**
   * Resolves a base asset to its default-quote pair (`SOL` → `SOLUSDT`).
   * Returns null when no pair with the preferred quote exists.
   */
  resolveBase(base: string, preferredQuote: string = PREFERRED_QUOTE_ASSET): MarketInfo | null {
    const resolvedBase = aliasBase(base) ?? base.toUpperCase();
    return this.bySymbol.get(`${resolvedBase}${preferredQuote}`) ?? null;
  }
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** Deterministic offline seed used by Demo Mode when Binance is unreachable. */
export const DEMO_SEED_SYMBOLS: MarketInfo[] = marketInfoForDemoSeeds();

let publicCatalogPromise: Promise<MarketCatalog | null> | null = null;
let cachedPublicCatalog: MarketCatalog | null = null;

export async function fetchBinancePublicCatalog(
  timeoutMs = 4000
): Promise<MarketCatalog | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(BINANCE_PUBLIC_EXCHANGE_INFO, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { symbols?: BinanceExchangeInfoSymbol[] };
    if (!Array.isArray(data.symbols) || data.symbols.length === 0) return null;
    return MarketCatalog.fromExchangeInfoSymbols(data.symbols);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function publicCatalogCached(): Promise<MarketCatalog | null> {
  if (cachedPublicCatalog) return cachedPublicCatalog;
  if (!publicCatalogPromise) {
    publicCatalogPromise = fetchBinancePublicCatalog().then((catalog) => {
      cachedPublicCatalog = catalog;
      setTimeout(() => {
        publicCatalogPromise = null;
        cachedPublicCatalog = null;
      }, 60 * 60 * 1000);
      return catalog;
    });
  }
  return publicCatalogPromise;
}

/**
 * Builds the authoritative catalog for a mode.
 *
 * Both Demo and Live resolve pairs against the real Binance instrument
 * metadata, so every coin currently listed and tradeable on Binance is
 * available in both modes. Demo order values remain deterministic
 * simulations (see `demoMarketForSymbol`), but the set of valid pairs is
 * the live listing.
 *
 * When the public endpoint is unreachable the mode falls back:
 * - Live fails closed with an empty catalog so a symbol can never silently
 *   pass as "verified" on guessed metadata.
 * - Demo falls back to the deterministic offline seed (well-known majors)
 *   so the rehearsal environment stays usable and reproducible offline.
 */
export async function createMarketCatalog(mode: Mode): Promise<MarketCatalog> {
  const live = await publicCatalogCached();
  if (live) return live;
  return mode === "live"
    ? MarketCatalog.fromList([])
    : MarketCatalog.fromList(DEMO_SEED_SYMBOLS);
}

function exchangeInfoToMarketInfo(raw: BinanceExchangeInfoSymbol): MarketInfo {
  const filters = raw.filters ?? [];
  const lotSize = filters.find((f) => f.filterType === "LOT_SIZE");
  const notional = filters.find((f) => f.filterType === "NOTIONAL");
  const priceFilter = filters.find((f) => f.filterType === "PRICE_FILTER");
  return {
    symbol: raw.symbol.toUpperCase(),
    baseAsset: raw.baseAsset.toUpperCase(),
    quoteAsset: raw.quoteAsset.toUpperCase(),
    status: raw.status.toUpperCase(),
    baseAssetPrecision: raw.baseAssetPrecision ?? 8,
    quoteAssetPrecision: raw.quoteAssetPrecision ?? 8,
    minQty: toFinite(lotSize?.minQty),
    maxQty: toFinite(lotSize?.maxQty),
    stepSize: toFinite(lotSize?.stepSize),
    minNotional: toFinite(notional?.minNotional),
    tickSize: toFinite(priceFilter?.tickSize),
  };
}

function toFinite(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}