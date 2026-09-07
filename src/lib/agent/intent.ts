import type { Intent, OpKind, Side } from "@/lib/types";
import { aliasBase, extractAmount as extractRawAmount, isStopword, symbolWordCandidates } from "@/lib/market/aliases";

export { parseAmountString } from "@/lib/market/aliases";

/**
 * A deliberately small natural-language intent parser.
 *
 * It extracts an action, a base asset or trading pair, an amount, and
 * whether that amount is quote units (USDT) or base units ("1 BNB").
 * The parser makes NO marketplace assumptions: the extracted token is a
 * candidate that the market catalog resolves and validates.
 */

const BUY_RE = /\b(buy|purchase|go long|accumulate|dca into)\b/i;
const SELL_RE = /\b(sell|exit|reduce)\b/i;
const ANALYZE_RE =
  /\b(analy[sz]e|analysis|look at|check the market|snapshot|status)\b/i;
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
  const parsedAmount = extractRawAmount(input);
  const amount = parsedAmount?.value ?? null;
  const amountType = parsedAmount?.type ?? null;
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
    op = "propose";
  } else if (side && QUESTION_RE.test(lower)) {
    op = "propose";
  } else if (side) {
    op = "propose";
  } else if (symbol || amount !== null) {
    op = "analyze";
  }

  return {
    raw,
    op,
    side,
    symbol,
    amount,
    amountType,
    quote,
  };
}

/**
 * Extracts the best candidate market token from a natural-language command.
 * Returns either a full pair ("BTCUSDT") or a base-asset/name token ("SOL",
 * "bitcoin"). Resolution and validation are the market catalog's job.
 */
export function extractSymbol(input: string): string | null {
  const upper = input.toUpperCase();

  const phrase = phraseAlias(upper);
  if (phrase) return phrase;

  const separatorPair = upper.match(/\b([A-Z0-9]{2,10})\s*[/-]\s*([A-Z]{2,6})\b/);
  if (separatorPair) {
    const base = aliasBase(separatorPair[1]);
    return base ? `${base}${separatorPair[2]}` : separatorPair[1];
  }

  const concatPair = upper.match(/\b([A-Z]{2,10})(USDT|USDC|BUSD|FDUSD|TUSD|DAI|EUR|TRY)\b/);
  if (concatPair) {
    const expanded = aliasBase(concatPair[1]) ?? concatPair[1];
    return `${expanded}${concatPair[2]}`;
  }

  const afterAmount = upper.match(/\b\d[\d.,]{0,14}\s+([A-Za-z]{2,10})\b/);
  if (afterAmount && !/^(USDT|USD|USDC|BUSD|FDUSD|TUSD|DAI|EUR|TRY)$/.test(afterAmount[1])) {
    const expanded = aliasBase(afterAmount[1]);
    if (!isStopword(afterAmount[1])) return expanded ?? afterAmount[1];
  }

  const afterPreposition = upper.match(/\b(?:of|in|for|worth of|into|and|on)\s+([A-Za-z]{2,10})\b/);
  if (afterPreposition && !isStopword(afterPreposition[1])) {
    const expanded = aliasBase(afterPreposition[1]);
    return expanded ?? afterPreposition[1];
  }

  const candidates = symbolWordCandidates(upper).filter((c) => /^[A-Z]{2,10}$/.test(c));
  if (candidates.length === 1) return aliasBase(candidates[0]) ?? candidates[0];
  if (candidates.length > 1) {
    const last = candidates[candidates.length - 1];
    return aliasBase(last) ?? last;
  }

  return null;
}

function phraseAlias(input: string): string | null {
  const m = input.match(/\bBINANCE\s+COIN\b/);
  if (m) return aliasBase("BINANCE COIN");
  const aliasMatch = input.match(/\b(BITCOIN|ETHEREUM|SOLANA|DOGECOIN|CARDANO|AVALANCHE|BINANCECOIN)\b/);
  if (aliasMatch) return aliasBase(aliasMatch[1]);
  return null;
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
      return `What amount should I use for the ${what}? (For example: "Buy $20 of SOL.")`;
    }
    if (missingSymbol) {
      return "Which market should I prepare the order for? (For example: SOLUSDT.)";
    }
  }
  if (op === "analyze" && missingSymbol) {
    return "Which market should I analyze? (For example: SOLUSDT.)";
  }
  return "What would you like RiskLens to do? I can analyze a market, prepare a buy or sell, or check an account balance.";
}

export function supportNotes(): string {
  return "RiskLens resolves Binance trading pairs dynamically from the live market catalog. Ask for any listed spot market — for example SOL, DOGE, XRP, BNB or AVAX. I can analyze a market, prepare a buy or sell amount, or check account balance.";
}