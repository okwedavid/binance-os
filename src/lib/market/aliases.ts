import type { AmountType } from "@/lib/types";

/**
 * Small, clearly-labeled alias map for well-known human coin names.
 *
 * This is deliberately NOT the source of truth for which markets exist.
 * Ticker resolution is driven by the market catalog (built from Binance
 * metadata); these aliases only let natural language such as "bitcoin" or
 * "solana" reach a base asset before the catalog validates the pair.
 */

export const SYMBOL_ALIASES: Record<string, string> = {
  BTC: "BTC",
  BITCOIN: "BTC",
  XBT: "BTC",
  ETH: "ETH",
  ETHER: "ETH",
  ETHEREUM: "ETH",
  SOL: "SOL",
  SOLANA: "SOL",
  BNB: "BNB",
  "BINANCE COIN": "BNB",
  BINANCECOIN: "BNB",
  XRP: "XRP",
  RIPPLE: "XRP",
  DOGE: "DOGE",
  DOGECOIN: "DOGE",
  ADA: "ADA",
  CARDANO: "ADA",
  AVAX: "AVAX",
  AVALANCHE: "AVAX",
  PEPE: "PEPE",
};

export const PREFERRED_QUOTE_ASSET = "USDT";

/** Quote assets whose pairing with a base produces an explicit symbol. */
export const KNOWN_QUOTES = [
  "USDT",
  "USDC",
  "BUSD",
  "FDUSD",
  "TUSD",
  "DAI",
  "EUR",
  "TRY",
];

/** Words that should never be treated as a ticker in bare-word parsing. */
const STOPWORDS = new Set([
  "BUY",
  "SELL",
  "PURCHASE",
  "GO",
  "LONG",
  "ACCUMULATE",
  "DCA",
  "INTO",
  "EXIT",
  "REDUCE",
  "ANALYZE",
  "ANALYSIS",
  "LOOK",
  "AT",
  "CHECK",
  "MARKET",
  "SNAPSHOT",
  "STATUS",
  "BALANCE",
  "ACCOUNT",
  "FUNDS",
  "ALLOCATION",
  "HOW",
  "MUCH",
  "SAFE",
  "AVAILABLE",
  "CAN",
  "SPEND",
  "AFFORD",
  "PREPARE",
  "SET",
  "UP",
  "PLACE",
  "EXECUTE",
  "SUBMIT",
  "SHOULD",
  "IF",
  "THE",
  "THEN",
  "PASS",
  "WHEN",
  "AND",
  "OR",
  "OF",
  "IN",
  "TO",
  "A",
  "AN",
  "ON",
  "FOR",
  "WORTH",
  "RISK",
  "BUYING",
  "SELLING",
  "ANALYZING",
  "MY",
  "ME",
  "AMOUNT",
  "SPOT",
  "BINANCE",
  "RISKLENS",
  "WITH",
  "I",
  "IS",
  "IT",
  "WE",
  "WOULD",
  "TELL",
  "ARE",
  "DOES",
  "DO",
  "WHAT",
  "S",
  "COIN",
  "COINS",
  "PAIR",
  "PERP",
  "PRICE",
  "TODAY",
  "NEW",
]);

export function isStopword(word: string): boolean {
  return STOPWORDS.has(word.toUpperCase());
}

export function symbolWordCandidates(input: string): string[] {
  const matches = input.toUpperCase().match(/[A-Z0-9]{2,12}/g) ?? [];
  return matches.filter((m) => !/^[0-9]+$/.test(m) && !isStopword(m));
}

/** Resolves a normalized word or short phrase to a base asset via aliases. */
export function aliasBase(word: string): string | null {
  const normalized = word.toUpperCase();
  const direct = SYMBOL_ALIASES[normalized];
  if (direct) return direct;
  const compact = normalized.replace(/\s+/g, "");
  return SYMBOL_ALIASES[compact] ?? null;
}

export interface NormalizedToken {
  base: string | null;
  quote: string | null;
}

/**
 * Normalizes a user-supplied market token into a base/quote pair.
 *
 * Accepted forms (case-insensitive):
 *   "btc"  "BTC"  "bitcoin"  "BTC/USDT"  "btc-usdt"  "BTCUSDT"  "SOL"
 * Multi-word human names are resolved via the alias phrase path.
 * The result is a suggestion only: the market catalog is the authority.
 */
export function normalizeToken(raw: string): NormalizedToken {
  const input = raw.trim().toUpperCase();
  if (!input) return { base: null, quote: null };

  for (const phrase of Object.keys(SYMBOL_ALIASES)) {
    if (phrase.includes(" ") && new RegExp(`\\b${phrase}\\b`, "i").test(input)) {
      const base = SYMBOL_ALIASES[phrase];
      return splitPair(input, base);
    }
  }

  if (input.includes("/") || input.includes("-")) {
    const parts = input.split(/[/-]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const base = aliasBase(parts[0]);
      const quote = aliasQuote(parts[1]);
      if (base && quote) return { base, quote };
      if (base) return { base, quote };
    }
  }

  const compact = input.replace(/[^A-Z0-9]/g, "");
  const concat = compact.match(/^([A-Z0-9]{2,10})(USDT|USDC|BUSD|FDUSD|TUSD|DAI|EUR|TRY)$/);
  if (concat) {
    return { base: aliasBase(concat[1]) ?? concat[1], quote: concat[2] };
  }

  const single = input.match(/^[A-Z0-9]{2,10}$/);
  if (single) {
    const base = aliasBase(single[0]);
    if (base) return { base, quote: null };
    return KNOWN_QUOTES.includes(single[0]) ? { base: null, quote: null } : { base: single[0], quote: null };
  }

  const mid = input.match(/\b([A-Z0-9]{2,10})\b/);
  if (mid) {
    const base = aliasBase(mid[1]);
    if (base) return { base, quote: null };
  }

  return { base: null, quote: null };
}

function splitPair(input: string, base: string): NormalizedToken {
  const parts = input.split(/[/-]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const quote = aliasQuote(parts[1]);
    if (quote) return { base, quote };
  }
  return { base, quote: null };
}

function aliasQuote(word: string): string | null {
  const upper = word.toUpperCase();
  return KNOWN_QUOTES.includes(upper) ? upper : null;
}

/**
 * Deterministic amount string parser shared by quote/base amounts.
 * - "20" → 20
 * - "1,000" → 1000
 * - "2,500" → 2500
 * - "10,000.50" → 10000.5
 * - "12,5" / "12.5" → 12.5
 * - "1.000" → null (ambiguous grouping; never guessed)
 */
export function parseAmountString(value: string): number | null {
  const cleaned = value.trim().replace(/^[$€£¥]\s?/, "");
  if (!/^\d[\d.,]*$/.test(cleaned)) return null;

  const hasDot = cleaned.includes(".");
  const hasComma = cleaned.includes(",");
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");

  if (hasDot && hasComma) {
    const decimalIsDot = lastDot > lastComma;
    const normalized = decimalIsDot
      ? cleaned.replace(/,/g, "")
      : cleaned.replace(/\./g, "").replace(",", ".");
    return toPositiveNumber(normalized);
  }

  if (hasComma) {
    const digitsAfter = cleaned.length - lastComma - 1;
    if (digitsAfter === 1 || digitsAfter === 2) {
      return toPositiveNumber(cleaned.replace(",", "."));
    }
    if (digitsAfter === 3) {
      return toPositiveNumber(cleaned.replace(/,/g, ""));
    }
    return null;
  }

  if (hasDot) {
    const digitsAfter = cleaned.length - lastDot - 1;
    if (digitsAfter === 0 || digitsAfter === 1 || digitsAfter === 2) {
      return toPositiveNumber(cleaned);
    }
    return null;
  }

  return toPositiveNumber(cleaned);
}

export interface RawAmount {
  value: number;
  type: AmountType;
}

/**
 * Extracts the requested order size from a natural-language command.
 *
 * - "$1,000" / "1,000 USDT" / "50 USDT worth of" → quote amount.
 * - "1 BNB" / "0.25 BTC" / "Sell 0.2 BTC" → base amount.
 * Returns null when no amount is present or the value is ambiguous.
 */
export function extractAmount(inputText: string): RawAmount | null {
  const input = inputText.trim();
  const dollar = input.match(/\$\s?(\d[\d.,]{0,14})\b/);
  if (dollar) {
    const value = parseAmountString(dollar[1]);
    if (value === null) return null;
    return { value, type: "quote" };
  }

  const qualified = input.match(/\b(\d[\d.,]{0,14})\s*(usdt|usd|tether)\b/i);
  if (qualified) {
    const value = parseAmountString(qualified[1]);
    if (value === null) return null;
    return { value, type: "quote" };
  }

  const baseQty = input.match(/\b(\d[\d.,]{0,14})\s+([A-Za-z]{2,10})\b/);
  if (baseQty) {
    const asset = baseQty[2].toUpperCase();
    const quoteWords = /^(USDT|USD|USDC|US|TETHER|EUR|BUSD|FDUSD)$/.test(asset);
    if (!quoteWords && !isStopword(asset) && aliasBase(asset) !== null) {
      const value = parseAmountString(baseQty[1]);
      if (value === null) return null;
      return { value, type: "base" };
    }
  }

  const plain = input.match(/\b(\d[\d.,]{0,14})\b/);
  if (plain && /\b(usdt|usd|dollars?)\b/i.test(input)) {
    const value = parseAmountString(plain[1]);
    if (value === null) return null;
    return { value, type: "quote" };
  }

  return null;
}

function toPositiveNumber(text: string): number | null {
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}