// Pure helpers for player stalls (screen 9). Money is bigint fils; nothing here uses Number on money.
// Rules come from contracts/caravan/DECISIONS.md (D5 to D8): the buyer pays qty x unit_price and nothing
// else, the SELLER pays a 2% fee (rounded up, at least 1 fils) out of the proceeds, stalls are same-city
// only, at most 5 open stalls per player, unit price 1 to 1,000,000,000 fils, cargo cap 40 for buyers.

import { BP, GOOD_IDS, PARAMS, type CityId, type ErrorCode, type GoodId, type Quote, type Stall } from "@caravan/shared";
import { ERROR_TEXT } from "./game-meta";
import { formatCoins, parseCoins, shortId } from "./format";

/** Contract constants (`MAX_STALLS_PER_PLAYER`, `MAX_STALL_UNIT_PRICE`); the shared PARAMS do not carry them. */
export const MAX_OPEN_STALLS = 5;
export const MIN_UNIT_PRICE_FILS = 1n;
export const MAX_UNIT_PRICE_FILS = 1_000_000_000n;

const big = (v: string | bigint): bigint => (typeof v === "bigint" ? v : BigInt(v));

/** What the buyer pays: qty x unit price. This is the whole price: the buyer never pays a fee. */
export function stallPrice(unit: string | bigint, qty: number): bigint {
  return big(unit) * BigInt(qty);
}

/** The seller's fee for one sale: 2% of the price rounded up, at least 1 fils (0 for a zero price). */
export function stallFee(price: bigint): bigint {
  if (price <= 0n) return 0n;
  const fee = (price * BigInt(PARAMS.STALL_FEE_BP) + BP - 1n) / BP;
  return fee < 1n ? 1n : fee;
}

/** What the seller keeps from one sale. */
export function sellerProceeds(price: bigint): bigint {
  return price - stallFee(price);
}

/** The line shown to the buyer under the exact price. */
export function feeNote(price: bigint): string {
  return `You pay exactly this price. The seller pays the 2% market fee (${formatCoins(stallFee(price))} coins on this purchase), not you.`;
}

/** Short friendly name for a seller. The API gives an account id only (no display name), so it is shortened. */
export function sellerLabel(seller: string, myAccount?: string | null): string {
  if (myAccount && seller === myAccount) return "You";
  const first = seller.split(".")[0] || seller;
  const hex = /^p([0-9a-f]{8})$/.exec(first);
  if (hex) return `Trader ${hex[1]!.slice(0, 4)}`;
  const name = first.length > 12 ? shortId(first, 8, 3) : first;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const byGoodThenPrice = (a: Stall, b: Stall): number => {
  const g = GOOD_IDS.indexOf(a.good) - GOOD_IDS.indexOf(b.good);
  if (g !== 0) return g;
  const pa = BigInt(a.unit_price);
  const pb = BigInt(b.unit_price);
  if (pa !== pb) return pa < pb ? -1 : 1;
  return a.id - b.id;
};

/** Other players' stalls in a city, grouped by good, cheapest first. Own stalls are left out. */
export function stallsForSale(stalls: readonly Stall[], city: CityId, myAccount: string | null | undefined): Stall[] {
  return stalls.filter((s) => s.city === city && s.seller !== myAccount).sort(byGoodThenPrice);
}

/** What a quantity box keeps of what was typed: digits only, at most four. */
export function qtyDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 4);
}

/** The player's own stalls in any city. */
export function myStalls(stalls: readonly Stall[], myAccount: string | null | undefined): Stall[] {
  if (!myAccount) return [];
  return stalls.filter((s) => s.seller === myAccount).sort((a, b) => a.id - b.id);
}

/** Most units one purchase can take: what the stall has, what fits in the caravan, what the purse can pay. */
export function maxStallBuyQty(stall: Pick<Stall, "qty" | "unit_price">, fils: bigint, carried: number): number {
  const unit = big(stall.unit_price);
  const room = Math.max(0, PARAMS.CARGO_CAP - carried);
  const affordable = unit > 0n ? fils / unit : 0n;
  const byFunds = affordable > BigInt(PARAMS.CARGO_CAP) ? PARAMS.CARGO_CAP : Number(affordable);
  return Math.max(0, Math.min(stall.qty, room, byFunds));
}

/** Why a purchase of `qty` cannot go ahead, or null. */
export function buyProblem(stall: Pick<Stall, "qty" | "unit_price">, qty: number, fils: bigint, carried: number): string | null {
  if (!Number.isInteger(qty) || qty < 1) return "Choose at least 1 unit.";
  if (qty > stall.qty) return `The stall only has ${stall.qty}.`;
  if (carried + qty > PARAMS.CARGO_CAP) return `Your caravan holds ${PARAMS.CARGO_CAP} units at most. You have room for ${Math.max(0, PARAMS.CARGO_CAP - carried)}.`;
  if (stallPrice(stall.unit_price, qty) > fils) return "Not enough coins.";
  return null;
}

/** How a stall's price compares with what the city's merchant asks (sells at) for one unit. */
export function priceVsMerchant(unit: string | bigint, quote: Pick<Quote, "ask">): "below" | "same" | "above" {
  const u = big(unit);
  const ask = big(quote.ask);
  return u < ask ? "below" : u > ask ? "above" : "same";
}

/** Plain coin text for an input box: no thousands separators ("1700" fils -> "17.00"). */
export function plainCoins(fils: string | bigint): string {
  return formatCoins(fils).replace(/,/g, "");
}

export type PriceParse = { ok: true; fils: bigint } | { ok: false; reason: string };

/** Parse the unit price a seller typed (coins, up to two decimals) and check the contract's range. */
export function parseUnitPrice(input: string): PriceParse {
  if (input.trim() === "") return { ok: false, reason: "Enter a price for each unit." };
  const fils = parseCoins(input);
  if (fils === null) return { ok: false, reason: "Use digits with at most two decimals, like 12.50." };
  if (fils < MIN_UNIT_PRICE_FILS) return { ok: false, reason: `The lowest price is ${formatCoins(MIN_UNIT_PRICE_FILS)} coins.` };
  if (fils > MAX_UNIT_PRICE_FILS) return { ok: false, reason: `The highest price is ${formatCoins(MAX_UNIT_PRICE_FILS)} coins.` };
  return { ok: true, fils };
}

export interface CreateInput {
  good: GoodId;
  qty: number;
  held: number;
  priceInput: string;
  openStalls: number;
}

export interface CreateCheck {
  problem: string | null;
  unit: bigint | null;
}

/** Validate the create form. `unit` is set whenever the price itself is valid, even if something else is wrong. */
export function validateCreate(i: CreateInput): CreateCheck {
  const price = parseUnitPrice(i.priceInput);
  const unit = price.ok ? price.fils : null;
  if (i.openStalls >= MAX_OPEN_STALLS) return { problem: `You already have ${MAX_OPEN_STALLS} open stalls, the most allowed. Close one first.`, unit };
  if (i.held < 1) return { problem: "You do not hold any of that.", unit };
  if (!Number.isInteger(i.qty) || i.qty < 1) return { problem: "Choose at least 1 unit.", unit };
  if (i.qty > i.held) return { problem: `You hold only ${i.held}.`, unit };
  if (!price.ok) return { problem: price.reason, unit };
  return { problem: null, unit };
}

export interface CreateHint {
  tone: "good" | "warn";
  text: string;
}

/** Guidance on a seller's price against the city merchant's bid (pays) and ask (sells at). */
export function createHint(unit: bigint, quote: Pick<Quote, "bid" | "ask">): CreateHint {
  if (unit < big(quote.bid)) {
    return { tone: "warn", text: "Below what the merchant pays. You would earn more selling to the merchant." };
  }
  if (unit > big(quote.ask)) {
    return { tone: "warn", text: "Above what the merchant sells at. Buyers will prefer the merchant." };
  }
  return { tone: "good", text: "Between the merchant's two prices: you earn more than selling to the merchant, and buyers pay less than buying from the merchant." };
}

export type StallAction = "buy" | "create" | "cancel";

/** Friendly text per ErrorCode, with a few stall specific wordings. Falls back to the shared ERROR_TEXT. */
export function stallErrorText(action: StallAction, code: ErrorCode): string {
  if (action === "buy") {
    if (code === "NOT_IN_CITY") return "The seller is away from this city, so the stall cannot sell right now. Try again later.";
    if (code === "BAD_REQUEST") return "That stall is gone: it sold out or the seller closed it.";
    if (code === "INSUFFICIENT_STOCK") return "The stall has fewer units than that now. Choose a smaller amount.";
  } else if (action === "create") {
    if (code === "RATE_LIMIT") return `Too fast, or you already have ${MAX_OPEN_STALLS} open stalls (the most allowed). Close one or wait a moment.`;
    if (code === "BAD_REQUEST") return "That price or amount was not accepted. Check the numbers and try again.";
    if (code === "INSUFFICIENT_STOCK") return "You do not hold that many.";
  } else {
    if (code === "NOT_IN_CITY") return "Go back to the stall's city to close it.";
    if (code === "BAD_REQUEST") return "That stall is already gone.";
  }
  return ERROR_TEXT[code];
}

/** Why a player cannot open a stall right now, or null. */
export function createBlockReason(i: {
  travelling: boolean;
  here: boolean;
  hereName: string;
  hasGoods: boolean;
  openStalls: number;
}): string | null {
  if (i.travelling) return "Your caravan is on the road. You can open a stall when it arrives.";
  if (!i.here) return `You can only open a stall in the city where you stand. Go to the stalls of ${i.hereName} to open one.`;
  if (i.openStalls >= MAX_OPEN_STALLS) return `You have ${MAX_OPEN_STALLS} open stalls, the most allowed. Close one first.`;
  if (!i.hasGoods) return "You hold no goods. Buy some at the market first, then sell them to other players here.";
  return null;
}
