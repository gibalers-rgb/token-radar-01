// Token Radar, model radar-4.
//
// One sealed DefiLlama snapshot in, one ranked board out. The board ranks
// protocols that record no token, by the implied value of a token they might
// one day issue. "Records no token" is DefiLlama's record, never proof a
// protocol has none: a watchlist protocol may still have a token its record
// does not carry.
//
// radar-4 keeps radar-3's spine and adds three signals, every one of them
// read from the snapshot itself, never from a hand-kept list of names:
//
//   1. Cleaner calibration. A category's multiple is the median
//      market-cap-to-TVL ratio of that category's live-token protocols,
//      shrunk toward the global median: (n * category_median + 3 * global)
//      / (n + 3). radar-4 adds one hygiene rule radar-3 lacked: a live
//      protocol only counts as a comp when its TVL is at least $10M, so a
//      token with almost no TVL and a huge market cap cannot set a whole
//      category's price. Ratios are clamped to [0.07, 1.30].
//   2. Category dominance. A protocol that leads its own category is worth
//      more than a small fish in the same pond: dominance =
//      1 + 0.08 * log10(TVL / category median TVL), clamped to [0.85, 1.20].
//      The median is taken over every protocol in the category, so the
//      factor measures standing inside the category, not raw size.
//   3. Category momentum. A rising tide lifts the category: momentum =
//      1 + clamp(category median 7-day change, -30%, +30%) * 0.30. A
//      protocol in a category whose median protocol is growing 20% in a
//      week earns up to +6%; one in a cooling category loses up to -9%.
//
// The rest is radar-3, unchanged in shape:
//   4. Saturation. Implied value grows sub-linearly with TVL: a protocol
//      ten times larger is not worth ten times more. scale =
//      (tvl / $100M) ^ -0.07, clamped to [0.75, 1.25].
//   5. Asymmetric growth. A 7-day TVL fall hurts more than the same rise
//      helps (down weight 0.65, up weight 0.45, clamped to [-80%, +100%]).
//   6. Maturity with a peak. Value rises with age up to three years
//      (0.55 -> 1.00), then slowly decays (to 0.85): a protocol that has
//      run five years and still records no token is less likely to launch
//      one tomorrow than one that has run two.
//   7. Breadth. More chains, wider distribution:
//      1 + 0.06 * ln(chains).
//
//   8. Same exclusion as the watchlist. The early rows below the floor
//      leave out the categories the watchlist itself leaves out — Bridge,
//      Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC
//      (and CEX): wrapped, staked and bridged products of protocols whose
//      token already trades are not token-launch candidates of their own.
//      The watchlist slugs are never filtered; only the early rows are.
//
//   implied = round(tvl * category_multiple * dominance * momentum
//                   * growth * maturity * breadth * saturation)
//
// The board is the 40 watchlist slugs (the floor, never the ceiling) plus
// every rankable early pre-token protocol below the $50M floor, ranked
// 1..N. Live token protocols are kept apart and shown with their market
// caps, never mixed into the ranking. Every row carries a ten-step farm
// plan whose cost and time are derived from the protocol's own category,
// chain, TVL, age and signals.

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
  comp_min_tvl_usd: number;
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
  dominance_step: number;
  dominance_floor: number;
  dominance_cap: number;
  momentum_weight: number;
  momentum_floor: number;
  momentum_cap: number;
  category_min_comps: number;
}

export const MODEL: ModelConstants = {
  shrink_prior: 3,
  multiple_floor: 0.07,
  multiple_cap: 1.3,
  comp_min_tvl_usd: 10_000_000,
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
  dominance_step: 0.08,
  dominance_floor: 0.85,
  dominance_cap: 1.2,
  momentum_weight: 0.3,
  momentum_floor: -30,
  momentum_cap: 30,
  category_min_comps: 2,
};

export const MODEL_VERSION = 'radar-4';
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
    dominance_multiplier: number;
    momentum_multiplier: number;
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
  category_comps: number;
  category_median_tvl: number | null;
  category_momentum: number | null;
  dominance_multiplier: number;
  momentum_multiplier: number;
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
  median_tvl_by_category: Record<string, number>;
  median_change_by_category: Record<string, number>;
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
  total_implied_value_usd: number;
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
 * positive and at least $10M, not a centralised exchange) give the
 * market-cap-to-TVL ratio per category; each category's multiple is its
 * median shrunk toward the global median by a prior of `shrink_prior`
 * pseudo-comps, then clamped. Categories with fewer than
 * `category_min_comps` live protocols get no entry of their own and fall
 * back to the global median at scoring time. The same pass also records
 * each category's median TVL (every protocol in the category) and median
 * 7-day change (protocols that report one), which the dominance and
 * momentum factors read.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const live = snapshot.protocols.filter(
    (p) =>
      p.mcap_usd !== null &&
      p.mcap_usd > 0 &&
      p.tvl_usd >= model.comp_min_tvl_usd &&
      p.category !== 'CEX',
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
  const tvls = new Map<string, number[]>();
  const changes = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? 'Other';
    const t = tvls.get(key) ?? [];
    t.push(p.tvl_usd);
    tvls.set(key, t);
    if (p.change_7d !== null && Number.isFinite(p.change_7d)) {
      const c = changes.get(key) ?? [];
      c.push(p.change_7d);
      changes.set(key, c);
    }
  }
  const medianTvl: Record<string, number> = {};
  for (const [key, values] of [...tvls.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const m = median(values);
    if (m !== null) medianTvl[key] = m;
  }
  const medianChange: Record<string, number> = {};
  for (const [key, values] of [...changes.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const m = median(values);
    if (m !== null) medianChange[key] = m;
  }
  return {
    global_median: global,
    by_category: byCategory,
    comps_by_category: comps,
    median_tvl_by_category: medianTvl,
    median_change_by_category: medianChange,
  };
}

export function categoryMultiple(p: SnapshotProtocol, calibration: Calibration): number {
  return calibration.by_category[p.category ?? 'Other'] ?? calibration.global_median;
}

/** Category dominance: leading a category is worth more than trailing it. */
export function dominanceMultiplier(
  p: SnapshotProtocol,
  calibration: Calibration,
  model: ModelConstants,
): number {
  const medianTvl = calibration.median_tvl_by_category[p.category ?? 'Other'];
  if (medianTvl === undefined || medianTvl <= 0) return 1;
  const log10 = Math.log10(Math.max(p.tvl_usd, 1) / medianTvl);
  return clamp(1 + model.dominance_step * log10, model.dominance_floor, model.dominance_cap);
}

/** Category momentum: the median protocol's 7-day move lifts or drags the whole category. */
export function momentumMultiplier(
  p: SnapshotProtocol,
  calibration: Calibration,
  model: ModelConstants,
): number {
  const medianChange = calibration.median_change_by_category[p.category ?? 'Other'];
  if (medianChange === undefined) return 1;
  const g = clamp(medianChange, model.momentum_floor, model.momentum_cap);
  return 1 + (g / 100) * model.momentum_weight;
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

export function signalsFor(
  p: SnapshotProtocol,
  age: number | null,
  calibration: Calibration,
  model: ModelConstants,
): string[] {
  const signals: string[] = [];
  const growth = finite(p.change_7d, 0);
  if (growth > 20) signals.push('Momentum');
  if (growth < -10) signals.push('Cooling');
  if (age !== null && age > 730) signals.push('Established');
  if (age !== null && age < 180) signals.push('Early');
  if (p.chains.length >= 4) signals.push('Broad');
  if (p.tvl_usd >= 5_000_000_000) signals.push('Giant');
  if (age !== null && age > 1825) signals.push('Patient');
  if (dominanceMultiplier(p, calibration, model) >= 1.1) signals.push('Leader');
  const momentum = momentumMultiplier(p, calibration, model);
  if (momentum >= 1.03) signals.push('Heating');
  return signals;
}

export interface Scored {
  implied: number;
  categoryMult: number;
  categoryComps: number;
  dominanceMult: number;
  momentumMult: number;
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
  const dominanceMult = dominanceMultiplier(protocol, calibration, model);
  const momentumMult = momentumMultiplier(protocol, calibration, model);
  const growthMult = growthMultiplier(protocol.change_7d, model);
  const maturityMult = maturityMultiplier(age, model);
  const breadthMult = breadthMultiplier(protocol.chains.length, model);
  const saturationMult = saturationMultiplier(protocol.tvl_usd, model);
  const implied = Math.max(
    1,
    Math.round(
      protocol.tvl_usd *
        categoryMult *
        dominanceMult *
        momentumMult *
        growthMult *
        maturityMult *
        breadthMult *
        saturationMult,
    ),
  );
  return {
    implied,
    categoryMult,
    categoryComps: calibration.comps_by_category[protocol.category ?? 'Other'] ?? 0,
    dominanceMult,
    momentumMult,
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
 * Categories the watchlist itself leaves out: wrapped, staked and bridged
 * products of protocols whose token already trades. They are not
 * token-launch candidates of their own, so they never enter as early rows.
 * (Watchlist slugs are added directly and never pass through this check.)
 */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/**
 * Rankable below the floor: pre-token, not in an excluded category, not a
 * versioned pool of another protocol, and not a wrapped/staked product by
 * name. The watchlist applies a stricter category exclusion of its own;
 * the early rows below the floor are the same kind of subject the starter
 * ranked — pre-token protocols of any remaining category — and the
 * dashboard always labels which rows are watchlist and which are early.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
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
    signals: signalsFor(s.p, s.v.age, calibration, model),
    model: {
      category_multiple: round4(s.v.categoryMult),
      category_comps: s.v.categoryComps,
      dominance_multiplier: round4(s.v.dominanceMult),
      momentum_multiplier: round4(s.v.momentumMult),
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      saturation_multiplier: round4(s.v.saturationMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age, calibration, model).map(stepText),
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

function categoryKind(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('collateral')) return 'lending';
  if (c.includes('cdp')) return 'cdp';
  if (c.includes('dex') || c.includes('leveraged farm')) return 'dex';
  if (c.includes('bridge') || c.includes('cross chain')) return 'bridge';
  if (c.includes('liquid restak')) return 'restaking';
  if (c.includes('liquid staking') || c.includes('staking pool')) return 'staking';
  if (c.includes('perpetual') || c.includes('derivative')) return 'perps';
  if (c.includes('yield') || c.includes('leveraged')) return 'yield';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('stable')) return 'stable';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('option') || c.includes('structured')) return 'options';
  if (c.includes('ai') || c.includes('agent')) return 'ai';
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return 'curator';
  if (c.includes('restak')) return 'restaking';
  if (c.includes('basis')) return 'basis';
  if (c.includes('chain')) return 'chain';
  if (c.includes('cedefi')) return 'cedefi';
  if (c.includes('payment')) return 'payments';
  if (c.includes('governance')) return 'governance';
  return 'general';
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const name = p.name;
  switch (categoryKind(p)) {
    case 'lending':
      return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
    case 'cdp':
      return `Deposit $${capital} of collateral into ${name} on ${chain} and mint its stable asset against it.`;
    case 'dex':
      return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
    case 'bridge':
      return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
    case 'staking':
      return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
    case 'restaking':
      return `Restake $${capital} of the liquid staking token through ${name} on ${chain} and keep the receipt token.`;
    case 'perps':
      return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
    case 'yield':
      return `Deposit $${capital} of USDC into the highest-TVL ${name} vault on ${chain} and let it compound.`;
    case 'rwa':
      return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
    case 'prediction':
      return `Fund $${capital} and place one market position on ${name}.`;
    case 'stable':
      return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
    case 'insurance':
      return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
    case 'options':
      return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares until expiry.`;
    case 'ai':
      return `Deposit $${capital} of USDC into ${name} on ${chain} and run one agent task through it.`;
    case 'curator':
      return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
    case 'basis':
      return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the shares.`;
    case 'chain':
      return `Bridge $${capital} of USDC to the chain ${name} runs on and use it in one app there.`;
    case 'cedefi':
      return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
    case 'payments':
      return `Pay $${capital} through ${name} on ${chain} so a real payment, not just a deposit, is on record.`;
    case 'governance':
      return `Lock $${capital} of the governance asset through ${name} on ${chain} and vote once.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
  }
}

function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const name = p.name;
  switch (categoryKind(p)) {
    case 'lending':
      return `Borrow $10 of USDC against the deposit on ${name}, then repay it the same week so the borrow is on record.`;
    case 'cdp':
      return `Use the minted stable asset to buy $10 of the collateral back through ${name}, so both sides of the vault are on record.`;
    case 'dex':
      return `Swap $10 of USDC for the pool's other asset through ${name} on ${chain} so a swap is on record too.`;
    case 'bridge':
      return `Bridge $10 back through ${name} so the round trip, not just one direction, is on record.`;
    case 'staking':
      return `Claim the staking rewards ${name} shows, even a small amount, and restake them.`;
    case 'restaking':
      return `Claim the restaking rewards ${name} shows and restake them, so the claim is on record too.`;
    case 'perps':
      return `Close the hedge on ${name} and open a second one half the size, so two trades are on record.`;
    case 'yield':
      return `Harvest the vault yield ${name} shows, even a small amount, and deposit it back into the same vault.`;
    case 'rwa':
      return `Check the yield ${name} reports for the position and leave it compounding for the full hold.`;
    case 'prediction':
      return `Settle the first position on ${name} and place a second one for the next market.`;
    case 'stable':
      return `Swap $10 of the stable asset back to USDC through ${name} on ${chain} so both directions are on record.`;
    case 'insurance':
      return `Read the cover terms ${name} shows for the policy and note the expiry date in the farm log.`;
    case 'options':
      return `Read the vault terms ${name} shows, including the expiry, and note them in the farm log.`;
    case 'ai':
      return `Run a second agent task through ${name} on ${chain}, different from the first one.`;
    case 'curator':
      return `Deposit another $10 into the same ${name} vault on ${chain} so the vault sees a second deposit.`;
    case 'basis':
      return `Check the funding ${name} reports for the basis vault and leave the position running for the full hold.`;
    case 'chain':
      return `Use a second app on the chain ${name} runs on, so the wallet is not a one-app wallet.`;
    case 'cedefi':
      return `Use one more feature of ${name} on ${chain}, such as a swap, a vote or a claim.`;
    case 'payments':
      return `Make a second, smaller payment through ${name} on ${chain} in the following week.`;
    case 'governance':
      return `Vote a second time through ${name} on ${chain} when the next proposal opens.`;
    default:
      return `Use one more feature of ${name} on ${chain}, such as a swap, a vote or a claim, so the wallet is not a one-action wallet.`;
  }
}

/** A third, deepening action: a second chain when the protocol runs on one, else a second feature. */
function deepenActionFor(p: SnapshotProtocol, chain: string): string {
  const name = p.name;
  if (p.chains.length >= 2) {
    const second = p.chains[1]!;
    return `Use ${name} on ${second} as well, with a small position, so the farm is on record on two chains instead of one.`;
  }
  switch (categoryKind(p)) {
    case 'dex':
      return `Add liquidity to a second ${name} pool on ${chain}, in a different pair, so two pools are on record.`;
    case 'lending':
      return `Supply a second asset, such as ETH, to ${name} on ${chain} so the wallet holds two supplied assets.`;
    case 'staking':
    case 'restaking':
      return `Use the receipt token ${name} gives in one DeFi app on ${chain}, so the stake is not sitting idle.`;
    case 'perps':
      return `Provide $10 to the ${name} liquidity vault on ${chain}, so the wallet is both a trader and a liquidity provider.`;
    case 'yield':
      return `Deposit $10 into a second ${name} vault on ${chain}, in a different strategy, so two vaults are on record.`;
    case 'prediction':
      return `Place a position in a second market category on ${name}, so two kinds of market are on record.`;
    case 'curator':
      return `Deposit $10 into a second ${name} vault on ${chain}, in a different strategy, so two vaults are on record.`;
    default:
      return `Use one more feature of ${name} on ${chain}, such as a swap, a vote or a claim, so the wallet is not a one-action wallet.`;
  }
}

/** One step that reads the protocol's own signals: momentum, cooling, youth, patience. */
function signalStepFor(p: SnapshotProtocol, age: number | null, signals: string[]): string {
  const name = p.name;
  if (signals.includes('Momentum')) {
    return `TVL on ${name} is growing fast, so add a second tranche only after the next weekly snapshot still shows growth, never on one green week alone.`;
  }
  if (signals.includes('Cooling')) {
    return `TVL on ${name} is falling, so keep the position small and do not add more until the 7-day change turns positive again.`;
  }
  if (signals.includes('Patient')) {
    return `${name} has run for years without a token, so treat the long track record as the point: hold the position through the whole plan instead of chasing newer farms.`;
  }
  if (signals.includes('Early')) {
    return `${name} is young, so keep the capital small until it survives its first quarter, and check its TVL every week before adding more.`;
  }
  if (signals.includes('Leader')) {
    return `${name} leads its category by TVL, so the farm is on the category's front-runner: hold the position even if a smaller rival grows faster for a week.`;
  }
  return `Check ${name}'s TVL once a week and add a second tranche only if the 7-day change is still positive.`;
}

/**
 * Ten farm steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chain, TVL, age, signals) — never from
 * a list of names. Step 1 is wallet hygiene, steps 2–3 are the
 * category's own actions, step 7 deepens the farm, step 8 reads the
 * signals, step 9 is the scam check, step 10 the exit.
 */
export function farmSteps(
  p: SnapshotProtocol,
  age: number | null,
  calibration: Calibration,
  model: ModelConstants,
): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasNote(chain);
  const signals = signalsFor(p, age, calibration, model);
  return [
    { text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline, never in a screenshot.`, cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and ${gas}`, time: '15 minutes to set up' },
    { text: secondActionFor(p, capital, chain), cost: 'about $10 of capital and gas', time: '10 minutes' },
    { text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and never do them all in one day.`, cost: 'gas once a week', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and keep the capital under 5% of your farm budget.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Once a month, open the protocol's own points or rewards page from its official site and record the points the wallet has earned.`, cost: 'no fee to check', time: '10 minutes a month' },
    { text: deepenActionFor(p, chain), cost: 'about $10 of capital and gas', time: '15 minutes' },
    { text: signalStepFor(p, age, signals), cost: 'nothing to check, the tranche is the only cost', time: '5 minutes a week' },
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

export function radarRow(row: BoardRow, watchlist: boolean, calibration: Calibration): RadarRow {
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
    category_comps: row.model.category_comps,
    category_median_tvl: calibration.median_tvl_by_category[row.category ?? 'Other'] ?? null,
    category_momentum: calibration.median_change_by_category[row.category ?? 'Other'] ?? null,
    dominance_multiplier: row.model.dominance_multiplier,
    momentum_multiplier: row.model.momentum_multiplier,
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
  const calibration = calibrate(snapshot, model);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    calibration,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_implied_value_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug), calibration)),
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
