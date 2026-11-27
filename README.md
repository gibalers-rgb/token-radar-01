# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/gibalers-rgb/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/gibalers-rgb/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks pre-token DeFi protocols by implied value — what a token
would be worth if the protocol launched one — and gives every protocol a
concrete farm plan, as a static dashboard that runs with no network.

## What it does

`main.ts` (Node 22, standard library only) reads the frozen DefiLlama
snapshot (`snapshot.json`: 758 protocols, 40 on the watchlist), scores every
pre-token protocol with the **radar-4 model**, and writes `board.json`,
`data.js`, a copy of `dashboard/` and `screenshots/`, and `dossier.json` to
the output directory. Two runs write byte-identical output, and the program
refuses to finish when `data.js` disagrees with `board.json`.

## The radar-4 model

Implied value is derived only from the snapshot's own figures — no protocol
name is special-cased:

```
implied = round( tvl_usd
  x category_multiple
  x dominance x momentum
  x growth x maturity x breadth x saturation )
```

Seven ideas over a flat multiple:

1. **Shrinkage calibration.** Each category's multiple is the median
   market-cap-to-TVL ratio of that category's live-token protocols with at
   least $10M TVL, shrunk toward the global median (0.188×) with a prior
   of 3 pseudo-comps and clamped to [0.07, 1.30]. A thin category cannot
   set its own price.
2. **Category dominance.** A protocol that leads its category earns more:
   `1 + 0.08 × log10(TVL / category median TVL)`, clamped to [0.85, 1.20].
3. **Category momentum.** A protocol in a heating category earns more:
   `1 + clamp(category median 7d change, -30%, +30%) × 0.30`.
4. **Asymmetric growth.** A 7-day TVL fall hurts more than the same rise
   helps (down weight 0.65, up weight 0.45, clamped to [-80%, +100%]).
5. **Maturity with a peak.** Value rises with age to 1.00 at three years,
   then decays slowly to 0.85 — a protocol that has run five years and still
   records no token is less likely to launch one tomorrow.
6. **Saturation.** TVL is sub-linear (`(TVL / $100M)^-0.07`, clamped to
   [0.75, 1.25]), so giants do not swallow the board. Breadth adds
   `1 + 0.06 × ln(chains)`.
7. **Same exclusion as the watchlist.** The early rows leave out Bridge,
   Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and
   CEX: wrapped, staked and bridged products of protocols whose token
   already trades are not token-launch candidates of their own.

Live-token protocols are set aside with their market caps shown, never mixed
into the ranking. Every row carries signals derived from the same figures
(Momentum, Early, Established, Broad, Cooling, Giant, Patient, Leader,
Heating).

The board covers all 40 watchlist slugs plus 138 early pre-token protocols
below the $50M floor (178 rows), ranked 1..178 by implied value — $2,177M
of total implied value, top row Steakhouse Financial at $405.8M. Each row
carries a ten-step farm plan with a cost and a time on every step, derived
from the protocol's category, chain, TVL and age — including wallet hygiene,
a category-specific main and second action, a weekly cadence, a hold period
set by age, a deepen step, a signal-aware step, a scam check (never pay to
claim) and a two-part exit.

## The dashboard

`dashboard/` is a static page (no framework, no network): a ranked board
with sortable columns, search, category / chain / signal filters, a
watchlist-only toggle, a live-token view set apart from the ranking, a top-3
spotlight, a **top-10 farm targets** list, a full **calibration table**
(every category's multiple, live-comp count, median TVL and median 7-day
change), a per-protocol detail view (model breakdown bars, a recompute check
against board.json, a "why this rank" line, farm plan), a **model sandbox**
that re-ranks the board live in the page, and a methodology section stating
the calibration. Open `out/dashboard/index.html` after a run.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

The grader runs it twice in a fresh container with no network; both runs must
write the same bytes. No API key and no environment variable is needed at
runtime.
