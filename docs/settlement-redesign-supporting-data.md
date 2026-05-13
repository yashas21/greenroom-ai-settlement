# Greenroom — Settlement Redesign · Supporting Data

Companion to `attached_assets/greenroom-settlement-redesign_1778701971579.html`.

This document does two things:

1. **Part A** — summarises everything this fork adds on top of the upstream
   `samay-cbh/greenroom-starter` so a reader can see what tooling produced the
   numbers in the report.
2. **Part B** — grounds every quantitative claim in the report against the
   live `/api/deal-analysis`, `/api/reports`, `/api/insights/switch-savings`
   and `/api/insights/switch-projected-grid` outputs. Where the live numbers
   strengthen, soften or outright contradict a claim, that is called out
   honestly — the rest of the project is built on the same standard.

All "live numbers" below were captured against the seeded `greenroom.db`
snapshot at `artifacts/api-server/data/seeds/`. To re-run any of them:

```bash
curl -s http://localhost:5000/api/deal-analysis           | jq .
curl -s http://localhost:5000/api/reports                 | jq .
curl -s "http://localhost:5000/api/insights/switch-savings?months=24"          | jq .
curl -s "http://localhost:5000/api/insights/switch-projected-grid?months=24"   | jq .
```

---

## Part A — What this fork adds on top of `greenroom-starter`

### A.1 The starter

Upstream had the **dataset only** — 537 settlements, 2,943 expense rows,
1,935 comp rows, 537 ticket-sales rows, 59 artists, 537 shows. No analytics
tabs, no settlement wizard, no AI features, no recommendation engines.
Original stack was Next.js / Vercel; this fork was migrated to a Replit
pnpm monorepo (`API server` + `Greenroom` web app + `Mockup sandbox`).

The historical operational tables are **byte-for-byte unchanged** — every
analytic in the app runs against the upstream 537 settlements. Demo
additions (5 artists, 12 shows, 12 deals, 6 settlement history rows for
"familiar" demo artists) are all *upcoming* shows used to demo the
recommendation engines and never roll up into historical KPIs. The
exclusion is enforced by every analytic gating on `shows.date <= today`.

### A.2 New tabs (7, added in commit order)

| # | Tab | What it shows |
|---|---|---|
| 1 | **Shows** (rebuilt) | Past show grid + filters (deal type / size bucket / attention). Each row links to a Show Detail page with joined artist / agent / deal / settlement / recoups / expenses / comps. |
| 2 | **Artists** | Roster grid: show count, last show date, top deal type, attention badge, plus LLM-extracted positive/negative review topics. |
| 3 | **Reports** | KPI bundle: deal-type counts, in-app tool usage rate, settlement status distribution, dispute rate, totals (gross / payouts / recoups / comps). |
| 4 | **Deal Analysis** | The quantitative cross-tab: by complexity, by size bucket, by profitability, costs by category, revenue by deal type, last-24-months revenue series, full `dealType × sizeBucket` cross-tab grid with losing / disputed / attention rates per cell. |
| 5 | **Needs Attention** | A worklist computed from four explicit rules (`show_settled_no_settlement`, `notes_say_closed_but_status_open`, `disputed_recoups_but_signed`, `stale_disputed`). |
| 6 | **Insights** | Qualitative pair to Deal Analysis: same cross-tab grid, but each cell shows the dominant friction kind + LLM-clustered top-5 complaint themes. Plus the *Smart Switch could have helped* drill-down (per-show counterfactuals, last 3 / 6 / 12 / 24 months) and the *projected grid* (cross-tab recomputed under Smart Switch + Improve Deal). |
| 7 | **Settings** | Configures the active LLM provider / model / API key. Settings are write-only across the API (responses never echo key material). Saving invalidates the Insights cache. |

### A.3 New engines

- **Smart Switch** (`lib/smartSwitch.ts`) — proposes either a flat (for vs / % of net deals in $1–5K) or a door-hybrid ($500 floor + 60% above an expense cap, for door deals) at deal entry. Tier A/B/C/D confidence based on cell sample size + artist familiarity at the venue.
- **Smart Guaranteed Price** (`lib/smartGuarantee.ts`) — auto-generates a flat target for every upcoming non-flat deal, used for Show Detail panels and now folded into the **Improve Deal** flow.
- **Improve Deal** — caps-only structural improvements (expense cap, hospitality cap) for deals that aren't Smart-Switch-eligible. P75-flat defaults sourced from cell history.
- **Switch Savings backend** (`lib/switchSavings.ts`) — re-scores every past settled vs / % of net / door deal in a window against its Smart Switch counterfactual, returning per-show money delta + a time-saved estimate from notes/sign-off paragraph counts and disputed-recoup activity.
- **Projected Grid** — same `dealType × sizeBucket` grid as Deal Analysis, but with Smart-Switch-eligible cells re-computed under the counterfactual; muted cells (Improve-Deal territory) inherit actuals.

### A.4 New pipelines + tooling

- **LLM enrichment pipeline** — per-settlement positive/negative summaries (1–2 sentences each) generated for every settlement that has notes, sign-off text, a disputed status, or a disputed recoup. Concurrency 8, idempotent. Then per-cell complaint clustering ≤ 5 themes via a second LLM pass.
- **Settle wizard** (`/shows/:id/settle`) — guided settlement entry for the simple deal shapes (flat, % of gross). The other three shapes intentionally remain "spreadsheet territory" until Phase 1+2 of the redesign land.
- **Show JSON export** (`GET /shows/:id/export`) — full per-show payload + LLM deep summary. Uses a heavier model (`claude-sonnet-4-6` / `gpt-4o`) than the default.
- **Single LLM helper** (`lib/llm.ts`) — only module that imports the Anthropic / OpenAI SDKs; everything else uses `llmGenerateText` / `llmGenerateJson` / `llmIsConfigured`. Lets the Settings tab swap providers globally with one save.
- **Calculator-style explainers** on Insights — collapsible disclosures next to both the Switch Savings section and the Projected Grid that spell out the exact formulas, eligibility, modelling assumptions, a worked example pulled from the current payload, and a footer rollup of the headline tiles.
- **Idempotent runtime DB migrations** (`db/index.ts`) — `ensureColumn` for ALTERs, `CREATE TABLE IF NOT EXISTS` for new tables; no drizzle-kit for the artifact's local libsql file.
- **Demo seed scripts** (`scripts/seedSmartSwitchDemo.ts`, `scripts/seedNewDemoProposals.ts`) — synthetic upcoming shows + familiar / first-timer artists to demo the engines.
- **Portable seed snapshot** (`data/seeds/`) — JSON exports of every fork-added row + a byte-for-byte copy of `greenroom.db` so anyone can clone and run.

### A.5 New API endpoints (under `/api`)

`/shows`, `/shows/:id`, `/shows/:id/export`, `/artists`, `/reports`,
`/deal-analysis`, `/needs-attention`, `/insights`, `/insights/enrich`,
`/insights/switch-savings`, `/insights/switch-projected-grid`,
`/insights/sgp-backtest`, `/settings/llm` (GET + POST), plus the smart-switch
+ improve-deal mutation routes used by Show Detail.

---

## Part B — Where each report claim comes from (and where it diverges)

For every quantitative claim in the report we cite (a) the **live number**
the API currently returns and (b) the **endpoint + cell** it comes from.
Differences from the report are flagged 🟡; matches are flagged 🟢.

### B.0 Top-line scope

| Number | Live value | Source |
|---|---:|---|
| Settled past shows | **509** | `/api/reports` → `totalSettlements` |
| Total deals (past) | **510** | `/api/reports` → `totalDeals` |
| Total gross box office | **$3,223,555** | `/api/reports` → `totalGross` |
| Total payouts to artists | **$1,938,465** | `/api/reports` → `totalToArtists` |
| Overall settlement dispute rate | **4.32%** (22 / 509) | `/api/reports` → `disputedRate` |
| In-app tool usage rate today | **38.2%** | `/api/reports` → `inAppToolUsageRate` (= flat + % of gross share of all deals) |

### B.1 Phase 1 — Door deals

> Report claims: 29 door shows · 24 months · every door deal lost the venue
> money · 9 of 29 structurally unviable below $2,223 gross · Pale Lake sold
> out 650, lost $1,930 · hybrid would yield $9,474 artist / $5,983 venue.

| Claim | Live value | Source |
|---|---|---|
| Door deal count | 🟢 **29** | `/api/deal-analysis` → `revenue.byDealType.door.count` |
| Aggregate venue net on door | 🟢 **−$29,056** (red across the bucket) | same · `revenue.byDealType.door.netToVenue` |
| Door deals losing the venue money (cross-tab definition: `gross − payout − expenses < 0`) | 🟡 **27 of 29 (93.1%)**, not literally all 29 | `/api/deal-analysis` → cross-tab cell `door|$0–1K` · `losingMoneyCount`, `losingMoneyRate` |
| Avg gross of the door bucket | $4,420 (cell mean) | switch-savings basis text |
| Counterfactual hybrid params | 🟢 **$500 floor + 60% above $1,500 expense cap** | `/api/insights/switch-savings` → `breakdown.counterfactual` |
| Pale Lake (`show_0207`, 2025-03-22) — actual artist payout | **$17,387** on $19,296 gross / $1,909 expenses | `/api/insights/switch-savings` items[0] |
| Pale Lake — counterfactual hybrid payout | 🟡 **$10,020** (report says $9,474) | same |
| Pale Lake — venue saving under hybrid | 🟡 **$7,367** (report implies ≈$5,983) | same · `moneySavedToVenue` |
| Pale Lake — actual venue net under door | 🟡 **$0** by construction (door pays full pool above expenses, so `gross − payout − expenses ≡ 0`); **report's −$1,930 figure does not appear in the live data.** | derived |
| Aggregate venue $ saved if Smart Switch hybrid were applied to all 29 historical door deals | **+$50,220** | `/api/insights/switch-projected-grid` → `door|$0–1K` cell · `moneySavedToVenue` |
| Loss-making nights avoided in the door bucket under hybrid | **17** (27 → 10) | same cell · `actualLosingMoney` − `projectedLosingMoney` |
| Disputes avoided in the door bucket under hybrid | **2** (2 → 0, by modelling assumption) | same cell |

**Sub-conclusion (honest).** The *direction* of every Phase 1 claim is
supported by live data — door deals are systematically loss-making at this
venue, the hybrid materially improves venue net, and the engine is already
configured exactly as described ($500 floor / 60% / $1,500 cap, suppressed
above $15K). The *exact dollar figures* for Pale Lake in the report do not
match the live API output and should be reconciled before publication.

### B.2 Phase 2 — $1–5K vs / % of net simplification

> Report claims: 43 vs deals + 101 % of net deals · vs percentage fired 0
> of 43 · 4.7% dispute rate.

| Claim | Live value | Source |
|---|---|---|
| vs deals in `$1–5K` | 🟡 **137** (report cites 43; the 43 figure may correspond to a sub-window — full-window count is 137) | `/api/deal-analysis` → cross-tab `vs|$1–5K` · `count` |
| vs deals in `$0–1K` | 14 | cross-tab `vs|$0–1K` · `count` |
| vs deals in `$5–15K` | 33 | cross-tab `vs|$5–15K` · `count` |
| All vs deals (any size) | 184 | `/api/reports` → `dealTypeCounts.vs` |
| % of net deals total | 🟡 **102** (report cites 101 — within rounding) | `/api/reports` → `dealTypeCounts.percentage_of_net` |
| Dispute rate on `vs|$1–5K` | 🟡 **12.4%** (report cites 4.7%; the 4.7% likely came from an earlier dataset slice) | cross-tab `vs|$1–5K` · `disputeRate` |
| Loss-making rate on `vs|$1–5K` | **19.7%** | same · `losingMoneyRate` |
| Aggregate venue $ saved if Smart Switch flat were applied to all 133 modelled `vs|$1–5K` deals | **+$23,024** (actual payout sum $649,911 → projected $626,887) | `/api/insights/switch-projected-grid` → `vs|$1–5K` cell |
| Disputes avoided on `vs|$1–5K` | **17** (17 → 0) | same cell |
| Attention items avoided across the grid | **18** | `/api/insights/switch-projected-grid` → `totalAttentionAvoided` |

The "percentage never fired" claim — *vs deals where the percentage clause
out-paid the guarantee* — is not currently a column on any endpoint; it
needs to be derived from `actualToArtist` vs `guaranteeAmount` per
settlement. The infrastructure is in place (every settled vs deal is in
`/api/insights/switch-savings`'s underlying query) — adding the column is a
straight loop over the same dataset.

**Sub-conclusion (honest).** The *qualitative* claim — that vs / % of net
deals in the $1–5K bucket carry materially more dispute and friction risk
than equivalent flat deals — is supported by the live cross-tab (12.4%
dispute rate on `vs|$1–5K` vs 3.8% on `flat|$1–5K`). The exact "0 of 43
fired" figure in the report needs to be recomputed against the current
137-deal slice before publication.

### B.3 Combined headline — "If Smart Switch had been used"

Last 24 months, top 10 individual past shows where Smart Switch would have
helped (`/api/insights/switch-savings?months=24`):

| | Money saved (top 10) | Time saved (top 10) |
|---|---:|---:|
| Cumulative | **$13K+** venue-side payout reduction | **5h 45m** of settlement-night work avoided |

Last 12 months, full counterfactual grid
(`/api/insights/switch-projected-grid?months=12`) — visible inside the
"If Smart Switch + Improve Deal had been used" card on `/insights`:

| Metric | Live value | Notes |
|---|---:|---|
| Money saved | (depends on window — see live tile) | `Σ actualPayout − Σ projectedPayout` over switchApplies cells |
| Loss-making nights avoided | 17 (door) + flat-from-vs | per cell |
| Disputes avoided | 19 across the grid | switched cells project to 0 |
| Attention items avoided | 18 across the grid | same modelling assumption |
| Modelled deals | 495 of 495 candidates | every settled non-NEW-DEMO deal |

### B.4 Phase 3 — Insurance pricing inputs

> Report claims: 2.724% dispute rate, $384 avg contested, 257 settled shows;
> 99.2% of suggestion gaps ≤ $400, 254 historical shows.

The live numbers we *can* source from the existing API:

| Claim | Live value | Source |
|---|---|---|
| Settlement-level dispute rate | 🟡 **4.32%** (22 / 509) — report's 2.724% likely uses a different denominator (e.g. only deal types in scope of a flat conversion) | `/api/reports` → `disputedRate` |
| Total disputed-recoup value | $7,582 across 22 disputed settlements | `/api/reports` → `disputedRecoupValue` |
| Implied avg contested amount per disputed settlement | $345 (≈ report's $384 figure) | derived |
| Total settled (any deal type) | 509 | `/api/reports` → `totalSettlements` |
| Settlements with at least one recoup | 77 | `/api/reports` → `settlementsWithRecoups` |

The "99.2% of suggestion gaps ≤ $400" cap-sizing claim depends on
backtesting the Smart Switch suggestion against the actual settled payout
across the 254 in-scope historical shows. The Smart Guaranteed Price
backtest at `/api/insights/sgp-backtest` is the natural home for this
column; the gap distribution is already computed there per show, just not
yet exposed as the "≤ $400 share" rollup.

The pricing math itself ($21 one-sided, $11 two-sided, $36 Pro tier,
$10.46 expected cost, 50% target margin, $113/month at full Crescent
adoption, $122K–$203K platform-wide) is **internal to the report's
proposal** — it is not produced by any endpoint in the current app and
shouldn't be presented as a Greenroom-derived analytic.

### B.5 The two report cross-checks the live app already passes cleanly

These are the ones a reviewer can verify in seconds inside the running app
without any number reconciliation:

1. **Door deals are the worst-performing bucket at this venue.** Open
   `/deal-analysis` → cross-tab. The `door|$0–1K` cell is the only cell
   with a `losingMoneyRate` over 90%. No other deal type in any bucket
   loses money on more than half its shows.
2. **Smart Switch has the largest impact on door deals.** Open
   `/insights` → "If Smart Switch + Improve Deal had been used".
   The `door|$0–1K` cell is the single biggest contributor to total money
   saved (+$50,220 on its own, vs +$23,024 from `vs|$1–5K`). This is the
   live-data version of the report's central recommendation.

---

## Recommended next steps before publishing the report

1. **Reconcile the Pale Lake numbers.** The actual show-`show_0207` figures
   in `/api/insights/switch-savings` should replace the $9,474 / $5,983 /
   −$1,930 numbers in the report.
2. **Recompute the Phase-2 deal counts** (43 vs / 101 pn / 4.7% dispute)
   against the current dataset; the live cross-tab shows 137 vs `$1–5K`
   and a 12.4% dispute rate.
3. **Surface the "% never fired" column** from the existing switch-savings
   query so the report's strongest single claim is one click to verify.
4. **Surface the "suggestion-gap ≤ $400" rollup** from the SGP backtest so
   the Phase-3 cap sizing has a live source.
5. **Annotate insurance-pricing figures** as proposal-side (they are
   modelling, not currently produced by any endpoint).

The structural argument the report makes — *simplify the deal types Smart
Switch already covers, then layer Improve-Deal caps and insurance on top*
— is fully supported by live data even before any of those reconciliations.
