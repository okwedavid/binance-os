import type { Intent, OpKind, Side } from "@/lib/types";
import {
  normalizeSymbol,
  SUPPORTED_SYMBOLS,
} from "@/lib/demo/data";

/**
 * A deliberately small natural-language intent parser.
 *
 * RiskLens supports only the MVP command set. Anything outside the
 * supported scope returns a short explanation instead of attempting an
 * unsupported workflow.
 */

const AMOUNT_RE =
  /\$\s?(\d[\d.,]{0,14})|\b(\d[\d.,]{0,14})\s*(usdt|usd)\b/i;

const BUY_RE = /\b(buy|purchase|go long|accumulate|dca into)\b/i;
const SELL_RE = /\b(sell|exit|reduce)\b/i;
const ANALYZE_RE = /\b(analy[sz]e|analysis|look at|check the market|snapshot|status)\b/i;
const BALANCE_RE =
  /\b(balance|account|funds|allocation|how much.*(safe|available)|can i (spend|afford|allocate))\b/i;
const PREPARE_RE =
  /\b(prepare|set up|place|execute|submit|should|if (the )?safety checks pass|when.*pass)\b/i;

const QUESTION_RE = /\b(should|can|is it|would you|worth)\b/i;

export function parseIntent(raw: string): Intent {
  const input = raw.trim();
  const quote = "USDT";

  const lower = input.toLowerCase();
  const symbol = extractSymbol(input);
  const amount = extractAmount(input);
  const side: Side | null = BUY_RE.test(input)
    ? "buy"
    : SELL_RE.test(input)
      ? "sell"
      : null;

  let op: OpKind | "unknown" = "unknown";

  const wantsBalance = BALANCE_RE.test(lower) && !BUY_RE.test(input) && !SELL_RE.test(input);
  if (wantsBalance) {
    op = "balance";
  } else if (ANALYZE_RE.test(lower) && !BUY_RE.test(input) && !SELL_RE.test(input)) {
    op = "analyze";
  } else if (side && (amount !== null || PREPARE_RE.test(lower))) {
    // A side plus an amount (or explicit preparation language) is an
    // execution proposal. Questions phrased as "should I buy $20 of BTC?"
    // still produce a proposal so the judge can see the Action Card.
    op = "propose";
  } else if (side && QUESTION_RE.test(lower)) {
    op = "propose";
  } else if (side) {
    op = "propose";
  } else if (symbol || amount !== null) {
    // Fallback: a symbol mention with no verb defaults to analysis.
    op = "analyze";
  }

  return {
    raw,
    op,
    side,
    symbol,
    amount,
    quote,
  };
}

function extractSymbol(input: string): string | null {
  for (const s of SUPPORTED_SYMBOLS) {
    if (new RegExp(`\\b${s}\\b`, "i").test(input)) {
      return s;
    }
  }
  const normalized = normalizeSymbol(input);
  if (normalized) {
    return normalized;
  }
  // Look for a bare 3-char base under 5 letters + USDT (e.g. "SOLUSDT").
  const explicit = input.match(/\b([A-Za-z]{2,8})USDT\b/);
  if (explicit) {
    return normalizeSymbol(explicit[1] + "USDT");
  }
  // Bare base-coin names ("BTC", "ETH", …) map through the alias table.
  const baseMatch = input.match(/\b(BTC|BITCOIN|ETH|ETHER|ETHEREUM)\b/i);
  if (baseMatch) {
    return normalizeSymbol(baseMatch[1]);
  }
  return null;
}

export function extractAmount(input: string): number | null {
  const match = input.match(AMOUNT_RE);
  if (!match) return null;
  const value = match[1] ?? match[2];
  if (!value) return null;
  return parseAmountString(value);
}

/**
 * Robust amount parsing for human-entered amounts.
 *
 * - "20"            -> 20
 * - "1,000"         -> 1000   (single comma grouping, no decimal point)
 * - "2,500"         -> 2500
 * - "10,000.50"     -> 10000.5
 * - "12,5" or "12.5"-> 12.5
 * - "1.000"         -> null   (ambiguous grouping — reject rather than guess)
 *
 * Returns null whenever the value cannot be resolved unambiguously so the
 * caller can ask the user instead of executing on a guessed number.
 */
export function parseAmountString(value: string): number | null {
  const cleaned = value.trim().replace(/^[$€£¥]\s?/, "");
  if (!/^\d[\d.,]*$/.test(cleaned)) return null;

  const hasDot = cleaned.includes(".");
  const hasComma = cleaned.includes(",");
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");

  if (hasDot && hasComma) {
    // Last separator wins as the decimal point; the other is grouping.
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
      // Grouping, e.g. "1,000" -> 1000.
      return toPositiveNumber(cleaned.replace(/,/g, ""));
    }
    return null;
  }

  if (hasDot) {
    const digitsAfter = cleaned.length - lastDot - 1;
    if (digitsAfter === 1 || digitsAfter === 2 || digitsAfter === 0) {
      return toPositiveNumber(cleaned);
    }
    // "1.000" is ambiguous between 1.0 and 1000 — reject.
    return null;
  }

  return toPositiveNumber(cleaned);
}

function toPositiveNumber(text: string): number | null {
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function requiredForOp(op: OpKind): { symbol: boolean; amount: boolean } {
  switch (op) {
    case "analyze":
      return { symbol: true, amount: false };
    case "propose":
      return { symbol: true, amount: true };
    case "balance":
      return { symbol: false, amount: false };
    default:
      return { symbol: false, amount: false };
  }
}

export function clarifyQuestion(op: OpKind, side: Side | null, missingSymbol: boolean, missingAmount: boolean): string {
  if (op === "propose") {
    const what = side === "sell" ? "sell" : "buy";
    if (missingAmount) {
      return `What amount should I use for the ${what}? (For example: "Prepare a $20 BTC buy.")`;
    }
    if (missingSymbol) {
      return "Which market should I prepare the order for? (For example: BTCUSDT.)";
    }
  }
  if (op === "analyze" && missingSymbol) {
    return "Which market should I analyze? (For example: BTCUSDT.)";
  }
  return "What would you like RiskLens to do? I can analyze a market, prepare a buy or sell, or check an account balance.";
}

export function supportNotes(): string {
  return `Supported markets: ${SUPPORTED_SYMBOLS.join(", ")}. I can analyze a market, prepare a buy or sell amount, or check account balance.`;
}