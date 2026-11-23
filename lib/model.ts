// Token Radar, model radar-3.
//
// One sealed DefiLlama snapshot in, one ranked board out. The board ranks
// protocols that record no token, by the implied value of a token they might
// one day issue. "Records no token" is DefiLlama's record, never proof a
// protocol has none: a watchlist protocol may still have a token its record
// does not carry.
//
// radar-3 differs from a flat multiple in four ways, every one of them read
// from the snapshot itself, never from a hand-kept list of names:
//
//   1. Shrinkage calibration. A category's multiple is the median
//      market-cap-to-TVL ratio of that category's live-token protocols, but
//      shrunk toward the global median: (n * category_median + 3 * global)
//      / (n + 3). A category with two live comps barely moves the global
//      figure; a category with fifteen earns its own. Ratios are clamped to
//      [0.07, 1.30] so one outlier (a prediction market with almost no TVL
//      and a huge market cap) cannot set a whole category's price.
//   2. Saturation. Implied value grows sub-linearly with TVL: a protocol
//      ten times larger is not worth ten times more, because the marginal
//      dollar of TVL buys less token demand. scale = (tvl / $100M) ^ -0.07,
//      clamped to [0.75, 1.25].
//   3. Asymmetric growth. A 7-day TVL fall hurts more than the same rise
//      helps (down weight 0.65, up weight 0.45, clamped to [-80%, +100%]).
//      A protocol bleeding TVL is a worse farm than a flat one.
//   4. Maturity with a peak. Value rises with age up to three years
//      (0.55 -> 1.00), then slowly decays (to 0.85): a protocol that has
//      run five years and still records no token is less likely to launch
//      one tomorrow than one that has run two.
//
//   implied = round(tvl * category_multiple * growth * maturity
//                   * breadth * saturation), breadth = 1 + 0.06 * ln(chains)
//
// The board is the 40 watchlist slugs (the floor, never the ceiling) plus
// 174 early pre-token protocols below the $50M floor, ranked 1..214. Live
// token protocols are kept apart and shown with their market caps, never
// mixed into the ranking. Every row carries an eight-step farm plan whose
// cost and time are derived from the protocol's own category, chain, TVL
// and age.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  shrink_prior: number;
  multiple_floor: number;
  multiple_cap: number;
  up_weight: number;
  down_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_peak_days: number;
  maturity_decay: number;
  maturity_decay_days: number;
  unknown_age_days: number;
  breadth_step: number;
  saturation_power: number;
  saturation_floor: number;
  saturation_cap: number;
  saturation_ref_usd: number;
  category_min_comps: number;
}

export const MODEL: ModelConstants = {
  shrink_prior: 3,
  multiple_floor: 0.07,
  multiple_cap: 1.3,
  up_weight: 0.45,
  down_weight: 0.65,
  growth_floor: -80,
  growth_cap: 100,
  maturity_floor: 0.55,
  maturity_peak_days: 1095,
  maturity_decay: 0.15,
  maturity_decay_days: 1825,
  unknown_age_days: 365,
  breadth_step: 0.06,
  saturation_power: -0.07,
  saturation_floor: 0.75,
  saturation_cap: 1.25,
  saturation_ref_usd: 100_000_000,
  category_min_comps: 2,
};

export const MODEL_VERSION = 'radar-3';
export const EARLY_ROWS = 220;
export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  signals: string[];
  model: {
    category_multiple: number;
    category_comps: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    saturation_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  saturation_multiplier: number;
  signals: string[];
  watchlist: boolean;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface Calibration {
  global_median: number;
  by_category: Record<string, number>;
  comps_by_category: Record<string, number>;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: Calibration;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`; null when the listing date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Shrinkage calibration. Live-token protocols (market cap recorded, TVL
 * positive, not a centralised exchange) give the market-cap-to-TVL ratio
 * per category; each category's multiple is its median shrunk toward the
 * global median by a prior of `shrink_prior` pseudo-comps, then clamped.
 * Categories with fewer than `category_min_comps` live protocols get no
 * entry of their own and fall back to the global median at scoring time.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const live = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX',
  );
  const globalRaw = median(live.map((p) => p.mcap_usd! / p.tvl_usd)) ?? 0.25;
  const global = clamp(globalRaw, model.multiple_floor, model.multiple_cap);
  const groups = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = groups.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    groups.set(key, list);
  }
  const byCategory: Record<string, number> = {};
  const comps: Record<string, number> = {};
  for (const [key, ratios] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const m = median(ratios);
    if (m === null || ratios.length < model.category_min_comps) continue;
    const shrunk = (ratios.length * m + model.shrink_prior * global) / (ratios.length + model.shrink_prior);
    byCategory[key] = clamp(shrunk, model.multiple_floor, model.multiple_cap);
    comps[key] = ratios.length;
  }
  return { global_median: global, by_category: byCategory, comps_by_category: comps };
}

export function categoryMultiple(p: SnapshotProtocol, calibration: Calibration): number {
  return calibration.by_category[p.category ?? 'Other'] ?? calibration.global_median;
}

/** Growth multiplier: falls hurt more than rises help. */
export function growthMultiplier(change7d: number | null, model: ModelConstants): number {
  const g = clamp(finite(change7d, 0), model.growth_floor, model.growth_cap);
  return 1 + (g / 100) * (g >= 0 ? model.up_weight : model.down_weight);
}

/** Maturity multiplier: rises to 1.00 at three years, then decays slowly to 0.85. */
export function maturityMultiplier(age: number | null, model: ModelConstants): number {
  const a = age ?? model.unknown_age_days;
  if (a <= model.maturity_peak_days) {
    return model.maturity_floor + (1 - model.maturity_floor) * (Math.max(a, 0) / model.maturity_peak_days);
  }
  const past = Math.min(a - model.maturity_peak_days, model.maturity_decay_days);
  return 1 - model.maturity_decay * (past / model.maturity_decay_days);
}

/** Breadth multiplier: more chains, wider distribution, up to ~1.10 at five chains. */
export function breadthMultiplier(chains: number, model: ModelConstants): number {
  return 1 + model.breadth_step * Math.log(Math.max(chains, 1));
}

/** Saturation multiplier: sub-linear TVL, so giants do not swallow the board. */
export function saturationMultiplier(tvl: number, model: ModelConstants): number {
  return clamp(
    Math.pow(Math.max(tvl, 1) / model.saturation_ref_usd, model.saturation_power),
    model.saturation_floor,
    model.saturation_cap,
  );
}

export function signalsFor(p: SnapshotProtocol, age: number | null): string[] {
  const signals: string[] = [];
  const growth = finite(p.change_7d, 0);
  if (growth > 20) signals.push('Momentum');
  if (growth < -10) signals.push('Cooling');
  if (age !== null && age > 730) signals.push('Established');
  if (age !== null && age < 180) signals.push('Early');
  if (p.chains.length >= 4) signals.push('Broad');
  if (p.tvl_usd >= 5_000_000_000) signals.push('Giant');
  if (age !== null && age > 1825) signals.push('Patient');
  return signals;
}

export interface Scored {
  implied: number;
  categoryMult: number;
  categoryComps: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  saturationMult: number;
  age: number | null;
}

export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: Calibration,
  model: ModelConstants,
): Scored {
  const age = ageDays(asOf, protocol.listed_at);
  const categoryMult = categoryMultiple(protocol, calibration);
  const growthMult = growthMultiplier(protocol.change_7d, model);
  const maturityMult = maturityMultiplier(age, model);
  const breadthMult = breadthMultiplier(protocol.chains.length, model);
  const saturationMult = saturationMultiplier(protocol.tvl_usd, model);
  const implied = Math.max(
    1,
    Math.round(protocol.tvl_usd * categoryMult * growthMult * maturityMult * breadthMult * saturationMult),
  );
  return {
    implied,
    categoryMult,
    categoryComps: calibration.comps_by_category[protocol.category ?? 'Other'] ?? 0,
    growthMult,
    maturityMult,
    breadthMult,
    saturationMult,
    age,
  };
}

/** A protocol records no token at all in the snapshot. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Rankable below the floor: pre-token, not an exchange, not a versioned
 * pool of another protocol, and not a wrapped/staked product by name. The
 * watchlist applies a stricter category exclusion of its own; the early
 * rows below the floor are the same kind of subject the starter ranked —
 * pre-token protocols of any category — and the dashboard always labels
 * which rows are watchlist and which are early.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category === 'CEX') return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  return true;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The board: every watchlist slug, plus the largest rankable early rows (up to EARLY_ROWS). */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const calibration = calibrate(snapshot, model);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, v: impliedValue(p, snapshot.as_of, calibration, model) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    signals: signalsFor(s.p, s.v.age),
    model: {
      category_multiple: round4(s.v.categoryMult),
      category_comps: s.v.categoryComps,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      saturation_multiplier: round4(s.v.saturationMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function gasNote(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 'about $5 to $15 of gas per transaction on Ethereum';
  if (c.includes('solana')) return 'about $0.01 of gas per transaction on Solana';
  if (c.includes('bitcoin') || c.includes('tron')) return 'about $1 to $3 of gas per transaction';
  if (
    ['base', 'arbitrum', 'optimism', 'polygon', 'bnb', 'binance', 'avalanche', 'bera', 'mode', 'blast', 'linea', 'scroll', 'zksync', 'mantle', 'hyperliquid', 'sonic', 'sui', 'aptos'].some(
      (k) => c.includes(k),
    )
  ) {
    return 'about $0.10 to $1 of gas per transaction on this chain';
  }
  return 'about $0.50 to $2 of gas per transaction on this chain';
}

/** Farm capital, from the protocol's own TVL: bigger protocols, bigger ticket. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('option') || c.includes('structured')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares until expiry.`;
  if (c.includes('ai') || c.includes('agent')) return `Deposit $${capital} of USDC into ${name} on ${chain} and run one agent task through it.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $10 of USDC against the deposit on ${name}, then repay it the same week so the borrow is on record.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Swap $10 of USDC for the pool's other asset through ${name} on ${chain} so a swap is on record too.`;
  if (c.includes('bridge')) return `Bridge $10 back through ${name} so the round trip, not just one direction, is on record.`;
  if (c.includes('staking') || c.includes('restak')) return `Claim the staking rewards ${name} shows, even a small amount, and restake them.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge on ${name} and open a second one half the size, so two trades are on record.`;
  if (c.includes('prediction')) return `Settle the first position on ${name} and place a second one for the next market.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit another $10 into the same ${name} vault on ${chain} so the vault sees a second deposit.`;
  if (c.includes('stable')) return `Swap $10 of the stable asset back to USDC through ${name} on ${chain} so both directions are on record.`;
  if (c.includes('rwa')) return `Check the yield ${name} reports for the position and leave it compounding for the full hold.`;
  if (c.includes('insurance')) return `Read the cover terms ${name} shows for the policy and note the expiry date in the farm log.`;
  return `Use one more feature of ${name} on ${chain}, such as a swap, a vote or a claim, so the wallet is not a one-action wallet.`;
}

/**
 * Eight farm steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chain, TVL, age) — never from a list of
 * names. Step 1 is wallet hygiene, step 7 is the scam check, step 8 the exit.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasNote(chain);
  return [
    { text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline, never in a screenshot.`, cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and ${gas}`, time: '15 minutes to set up' },
    { text: secondActionFor(p, capital, chain), cost: 'about $10 of capital and gas', time: '10 minutes' },
    { text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and never do them all in one day.`, cost: 'gas once a week', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and keep the capital under 5% of your farm budget.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Once a month, open the protocol's own points or rewards page from its official site and record the points the wallet has earned.`, cost: 'no fee to check', time: '10 minutes a month' },
    { text: `Never pay to claim, never connect the wallet to a link from a direct message, and check the claim address on the protocol's own page first.`, cost: 'nothing, and a paid claim is a scam', time: '5 minutes' },
    { text: `Write the wallet, the dates and every transaction in a farm log, then plan the exit: withdraw in two parts so a failed transaction never strands the whole position.`, cost: 'nothing but the log', time: '5 minutes' },
  ];
}

/** Live-token protocols by market cap, for the dashboard's separate Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

export function radarRow(row: BoardRow, watchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    saturation_multiplier: row.model.saturation_multiplier,
    signals: row.signals,
    watchlist,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    calibration: calibrate(snapshot, model),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug))),
    live,
  };
  return { board, radar };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function fieldNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (!isRecord(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const asOf = fieldString(raw, 'as_of');
  if (asOf === null || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new SnapshotError('snapshot.json has no as_of date');
  const source = fieldString(raw, 'source');
  if (source === null) throw new SnapshotError('snapshot.json has no source');
  const floor = fieldNumber(raw, 'floor_usd');
  if (floor === null || !Number.isSafeInteger(floor) || floor <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(raw.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(raw.watchlist) || raw.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  return {
    as_of: asOf,
    source,
    floor_usd: floor,
    protocols: raw.protocols.map((v, i) => parseProtocol(v, i)),
    watchlist: raw.watchlist as string[],
  };
}

function parseProtocol(value: unknown, index: number): SnapshotProtocol {
  if (!isRecord(value)) throw new SnapshotError(`snapshot.json's protocol ${index} is not an object`);
  const slug = fieldString(value, 'slug');
  const name = fieldString(value, 'name');
  const tvl = fieldNumber(value, 'tvl_usd');
  if (slug === null || name === null || tvl === null) {
    throw new SnapshotError(`snapshot.json's protocol ${index} lacks a slug, a name or a TVL`);
  }
  const chains = Array.isArray(value.chains)
    ? value.chains.filter((c): c is string => typeof c === 'string')
    : [];
  return {
    slug,
    name,
    category: fieldString(value, 'category'),
    chains,
    tvl_usd: tvl,
    change_7d: fieldNumber(value, 'change_7d'),
    mcap_usd: fieldNumber(value, 'mcap_usd'),
    listed_at: fieldString(value, 'listed_at'),
    gecko_id: fieldString(value, 'gecko_id'),
    symbol: fieldString(value, 'symbol'),
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
  }
  return null;
}

/** The dashboard's whole dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
