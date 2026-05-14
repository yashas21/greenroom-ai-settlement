# Greenroom

A booker-facing dashboard for a small live-music venue. Tracks shows, deals,
and settlements; flags follow-ups; and surfaces qualitative friction patterns
across past deals using an LLM enrichment pipeline.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000 / proxied)
- `pnpm --filter @workspace/greenroom run dev` — run the web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (libsql/sqlite file is used for the Greenroom artifact's own data at `artifacts/api-server/data/greenroom.db`)
- Optional env (LLM fallback if no key is saved in the Settings tab):
  `AI_INTEGRATIONS_ANTHROPIC_API_KEY`, `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`,
  `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: libsql/sqlite + Drizzle ORM (file-backed at `data/greenroom.db`)
- Frontend: Vite + React + wouter + Tailwind v4 + shadcn/ui + Recharts
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle for the API server)
- LLM: provider-agnostic helper in `artifacts/api-server/src/lib/llm.ts`
  wrapping the Anthropic and OpenAI SDKs. Active provider/model/key are read
  from the `settings` k/v table at call time, with env vars as fallback.

## Tabs / Pages

The sidebar exposes seven tabs. Each one is documented below with what it
shows and exactly how its numbers are computed.

### 1. Shows (`/shows`)

Lists every past or current show (`shows.date <= today`). The detail page
(`/shows/:id`) joins the show against artist, agent, agency, venue, deal,
settlement, ticket sales, expenses, comps, and recoups; each show also has a
**Settle** wizard at `/shows/:id/settle`.

Calculations (`getAllShows`, `getShowById` in `lib/queries.ts`):
- **isUnsupportedDeal** — `dealType ∈ {percentage_of_net, vs, door}`. These
  three deal shapes are not modelled in the in-app settle wizard.
- **isDisputed** — `settlement.status === "disputed"` OR any recoup line
  inside `settlement.recoupsJson` has `status === "disputed"`.
- **expenseCategories / recoupCategories / disputedRecoupCategories** —
  unique categories aggregated from the joined expense and recoup rows.

The card grid offers filters (deal type, size bucket, attention) sourced
from the `deals` row and the `getNeedsAttention` flags below.

### 2. Artists (`/artists`)

A grid of every artist with show counts, last show date, top deal type, the
review-tone topics drawn from LLM summaries, and a flagged-attention badge.

Calculations (`getAllArtists` in `lib/queries.ts`):
- **showCount / lastShowDate** — `count(shows.id)` and `max(shows.date)`
  grouped by artist.
- **topDealType / dealTypes[]** — counts of each `deals.dealType` per artist
  joined via `shows`, sorted descending. The single highest-count deal type
  is shown as the headline chip.
- **topPositive / topNegative** — first sentence (capped at ~90 chars) of
  the most-recent non-empty `settlements.positiveSummary` /
  `negativeSummary` across all of the artist's shows. These columns are
  populated by the LLM enrichment pipeline (see Insights below).
- **attentionCount** — number of `getNeedsAttention()` items whose `showId`
  belongs to this artist.

The page also has filter pills above the grid (top-deal-type) sourced from
the `dealTypes[]` field.

### 3. Reports (`/reports`)

High-level KPIs across all past shows. Calculations (`getReports` in
`lib/queries.ts`):
- **dealTypeCounts** — `count(*)` of each `deals.dealType` for past shows.
- **inAppToolUsageRate** — `count(deal_type ∈ {flat, percentage_of_gross})
  / total deals`. Reflects what fraction of past deals could in principle
  be settled inside the in-app wizard rather than on a spreadsheet.
- **settlementStatus** — distribution of `settlements.status` strings.
- **disputedRate** — `settlementStatus.disputed / totalSettlements`.
- **totalGross / totalToArtists** — sum of `settlements.grossBoxOffice` and
  `settlements.totalToArtist` across past settlements.
- **totalRecoupValue / disputedRecoupValue / settlementsWithRecoups** —
  parsed from `settlements.recoupsJson`; disputed value is the sum of
  `r.amount` for `r.status === "disputed"`.
- **totalCompTickets / totalCompFaceValue / compsByCategory** —
  `Σ comps.count`, `Σ count × faceValue`, and counts grouped by
  `comps.category`.

### 4. Deal Analysis (`/deal-analysis`)

Quantitative breakdown of what kinds of deals the venue runs and how they
perform. Powered by `getDealAnalysis` in `lib/queries.ts`.

- **byComplexity** — every past deal is classified as
  `simple` / `medium` / `complex` by `classifyComplexity()`:
  - `complex` if dealType is `vs`, `door`, or `percentage_of_net`, OR if
    the deal has bonuses (`bonusesJson` non-empty), OR has any
    `dealNotesFreetext`.
  - `medium` if dealType is `percentage_of_gross`, OR has `expenseCap` or
    `hospitalityCap`.
  - `simple` otherwise (clean flat guarantee).
  - Per bucket: `count`, `pct = count / totalDeals`, `avgPayout`
    (mean of `totalToArtist` for settled shows in bucket), `inToolCount`
    (deal types modelled by the wizard), `spreadsheetCount` (the rest).
- **bySize** — every past deal is bucketed by `classifySizeBucket()`:
  - Bucket = `Uncapped %` if `guaranteeAmount == 0/null` and `percentage`
    is set; otherwise binned by guarantee into `$0–1K`, `$1–5K`,
    `$5–15K`, `$15K+`.
  - Per bucket: `count`, `pct`, `avgGross` (mean
    `settlements.grossBoxOffice`), `avgToArtist` (mean
    `totalToArtist`), `disputeRate = disputed / settledN`,
    `losingMoneyCount`, `profitN`.
  - `losingMoney` for a settled show =
    `grossBoxOffice − totalToArtist − Σ expenses < 0`.
- **byProfitability** — partitions every settled show with both a gross and
  a payout figure into `profitable` / `unprofitable` using the same net
  formula above; reports `disputeRate` per side.
- **costs** — `totalExpenses`, `expensesByCategory`, `totalRecoups`,
  `disputedRecoupValue`, and `recoupsByCategory` (with disputed amounts
  separated). All summed across past shows.
- **revenue.byDealType** — for each `dealType`, `Σ gross`,
  `Σ netToVenue` (gross − payout − expenses), `Σ toArtist`, and
  settlement count over past shows.
- **revenue.months** — last 24 calendar months. Per month: `gross`,
  `netToVenue`, `toArtist`, plus `byType` (gross broken down by deal type
  for stacked-area charts).
- **revenue.crossTabBySizeAndType** — the cross-tab grid (rows = deal type,
  columns = size bucket). Per cell:
  `count`, `settledN`, `profitN`, `losingMoneyCount`,
  `disputed`, `losingMoneyRate = losingMoney/profitN`,
  `disputeRate = disputed/settledN`,
  `attentionCount`, `attentionRate = attentionCount/count`,
  and `attentionByKind` (count of distinct kinds from the Needs-Attention
  flagger).

### 5. Needs Attention (`/needs-attention`)

A worklist of past shows whose data smells off. Computed by
`getNeedsAttention()` (`lib/queries.ts`) using four rule kinds:

- **`show_settled_no_settlement`** — `show.status ∈ {settled, closed}` but
  there is no `settlements` row for that show.
- **`notes_say_closed_but_status_open`** — settlement is *not* in a closed
  status but `notes` or `signoffText` contains a closure phrase. The regex
  matches a fixed vocabulary: `closed out`, `settled up`, `fully settled`,
  `signed off`, `signed and paid`, `paid in full`, `paid out`, `finalized`,
  `wrapped up`, `squared away`, `all squared`, `case closed`. The matched
  phrase is included as `evidence`.
- **`disputed_recoups_but_signed`** — settlement status IS closed
  (`signed | finalized | paid`) but at least one recoup line in
  `recoupsJson` has `status === "disputed"`. Lists the disputed labels +
  amounts as evidence.
- **`stale_disputed`** — settlement status is `disputed` and
  `disputedAt` is more than 30 days ago.

Each item carries `kind`, `showId`, `artistName`, `date`, `status`,
`settlementStatus`, a human `detail` line, and (when relevant) `evidence`.

### 6. Insights (`/insights`)

The qualitative companion to Deal Analysis. Same `dealType × sizeBucket`
grid, but each cell shows the dominant friction kind for those deals plus
a top-5 cluster of the actual recurring complaints behind it. Powered by
`getInsights()` and `enrichSettlements()` in `lib/insights.ts`.

Pipeline:

1. **Per-settlement enrichment** (`POST /api/insights/enrich`).
   Picks every settlement that has either `notes`, `signoffText`, a
   disputed status, or a disputed recoup. For each one not already
   enriched, calls the active LLM with a structured payload (deal +
   settlement + recoups + freetext) and stores two new columns on the
   row: `positiveSummary` and `negativeSummary` (each 1–2 sentences,
   strict JSON output). Concurrency = 8 workers; idempotent (skips rows
   that already have summaries unless `force: true`).
2. **Grid build** (`GET /api/insights`). Re-uses the same
   `classifySizeBucket()` from Deal Analysis. Per cell:
   - `count` — total past deals in the cell.
   - `attentionCount` — deals in the cell that have at least one
     Needs-Attention flag.
   - `byKind[k]` — distinct-kind counts (a deal is counted once per
     kind even if flagged twice).
   - `topKind` / `topKindCount` — the kind with the highest count, with
     ties broken by `KIND_PRIORITY = [stale_disputed,
     disputed_recoups_but_signed, show_settled_no_settlement,
     notes_say_closed_but_status_open]`.
3. **Complaint clustering** — for each cell with a `topKind`, gather the
   `negativeSummary` of every flagged deal in that cell, then call the
   active LLM **once per cell** to cluster them into AT MOST 5 themes
   (`{theme, count}`), ordered by count desc.
4. **Caching** — the full payload is cached in-module after the first
   compute and reused until the server restarts, the Settings tab is
   saved, or `clearInsightsCache()` is called. A second concurrent
   request awaits the same in-flight promise (`pending`) instead of
   re-running the pipeline.

The page also reports `enrichmentCoverage = withSummary / total` so you
can tell how much of the corpus has been processed.

### 7. Settings (`/settings`)

Configures which LLM the server calls and stores keys persistently. UI:
provider radio (Anthropic / OpenAI), per-provider API-key password input
(shows `•••••••• (saved)` plus a Clear button when a key is already
persisted), per-provider model dropdown, save button, and a footer line
showing the active provider/model/source.

Backend (`lib/llm.ts`, routes in `routes/greenroom.ts`):

- Storage — a simple `settings (key TEXT PRIMARY KEY, value TEXT)` table
  created on startup by `migrationsReady`. Keys used:
  `llm.provider`, `llm.anthropic.apiKey`, `llm.anthropic.model`,
  `llm.openai.apiKey`, `llm.openai.model`.
- `getLlmConfig()` — reads the `settings` table on every call, falling
  back to `AI_INTEGRATIONS_*` env vars when no key is saved. When a saved
  key is present, the env-var `BASE_URL` override is intentionally NOT
  applied (so user-supplied keys hit the canonical provider endpoint).
- `getLlmStatus()` / `GET /api/settings/llm` — returns metadata only:
  `activeProvider`, `activeModel`, `source ∈ {settings, env, none}`,
  `hasKey`, plus per-provider `{configured, source, model}` and the
  list of selectable models. **Never returns raw key material.**
- `saveLlmSettings()` / `POST /api/settings/llm` — accepts partial
  updates (provider / *ApiKey / *Model). After saving, the insights cache
  is cleared so the next `GET /api/insights` re-runs against the new
  active model.
- `llmGenerateText({prompt, modelOverride?, maxTokens?})` — provider-agnostic
  text completion. Anthropic path: `messages.create` with the active model
  and the first text block of the response. OpenAI path: `chat.completions.create`
  with `messages: [{role:"user", content: prompt}]` and the first
  `choice.message.content`.
- `llmGenerateJson<T>()` — wraps `llmGenerateText` with a tolerant
  `extractJson` that strips ```json fences and falls back to the first
  `{…}` substring before `JSON.parse`.

Both LLM call sites route through this helper:

- `lib/insights.ts` — uses `llmGenerateJson` for both the per-settlement
  summary and the per-cell complaint clustering, gated on
  `llmIsConfigured()`.
- `lib/showExport.ts` — uses `llmGenerateText` for the show-export deep
  summary, with a `modelOverride` of `claude-sonnet-4-6` (Anthropic) or
  `gpt-4o` (OpenAI) so this heavier prompt always uses a stronger model
  than the default.

## Where things live

- **DB schema** — `artifacts/api-server/src/db/schema.ts` (sqlite via
  Drizzle). Idempotent runtime migrations live in
  `artifacts/api-server/src/db/index.ts` (`ensureColumn` for ALTERs,
  `CREATE TABLE IF NOT EXISTS` for new tables).
- **Calculations** — `artifacts/api-server/src/lib/queries.ts` (everything
  except Insights), `artifacts/api-server/src/lib/insights.ts` (the
  enrichment + clustering pipeline), `artifacts/api-server/src/lib/showExport.ts`
  (per-show JSON export with LLM summary).
- **LLM helper** — `artifacts/api-server/src/lib/llm.ts`. Single source of
  truth for which provider/key/model to use. Add new call sites here.
- **HTTP routes** — `artifacts/api-server/src/routes/greenroom.ts`.
- **Frontend pages** — `artifacts/greenroom/src/pages/{shows, show-detail,
  settle, artists, reports, deal-analysis, needs-attention, insights,
  settings}.tsx`.
- **API client + types** — `artifacts/greenroom/src/lib/api.ts`,
  `artifacts/greenroom/src/lib/types.ts`.
- **Sidebar / nav** — `artifacts/greenroom/src/components/layout/nav-links.tsx`.
- **Portable seed snapshot** — `artifacts/api-server/data/seeds/`. JSON
  exports of every row added on top of the upstream starter dataset
  (`artists.json`, `shows.json`, `deals.json`, `settlements.json`,
  `switch_suggestions.json`, `guarantee_suggestions.json`) plus a
  byte-for-byte copy of the live
  `greenroom.db`. The folder's `README.md` explains how this fork's data
  relates to [`samay-cbh/greenroom-starter`](https://github.com/samay-cbh/greenroom-starter)
  and gives a recipe for recreating the dataset from scratch. Refresh the
  snapshot after any structural data change with
  `pnpm --filter @workspace/api-server exec tsx scripts/exportSeedsSnapshot.ts`.

## Architecture decisions

- **No drizzle-kit for the Greenroom DB.** The artifact's data is a local
  libsql file, not the workspace Postgres, so schema changes are applied
  at boot time via small `ensureColumn` / `CREATE TABLE IF NOT EXISTS`
  helpers in `db/index.ts`. This keeps the artifact self-contained.
- **All LLM access goes through one helper.** `lib/llm.ts` is the only
  module that imports the Anthropic or OpenAI SDKs. Call sites only see
  `llmGenerateText` / `llmGenerateJson` / `llmIsConfigured`. This is what
  lets the Settings tab swap providers globally with a single save.
- **Settings keys are write-only across the API.** The settings GET/POST
  responses contain only `{configured, source, model}` per provider —
  raw API keys are never shipped back to the client.
- **Insights uses a deterministic priority for ties.** `KIND_PRIORITY`
  fixes the topKind ordering when two attention kinds tie inside a cell,
  so the cluster runs against a stable choice and the cached payload is
  reproducible.
- **Insights is cached in-module with a race-safe pending promise.** The
  first request computes; concurrent requests await the same promise; the
  cache is invalidated only by a server restart, a Settings save, or an
  explicit `clearInsightsCache()` call from the enrich route.
- **Smart Switch owns flat conversion; Improve Deal is caps-only.** The
  audit (Apr 2026) showed that "convert this %-deal to a flat" is only
  data-safe in the cells Smart Switch already covers (`vs`/`pn` at $1–5K,
  `door` any size). Improve Deal therefore emits only structural-cap
  suggestions (expense cap, hospitality cap), with audit-derived P75-flat
  defaults — no bucket-scaling, since expenses and hospitality are flat
  across gross levels at this venue. Smart Switch suggestions carry a
  `source` enum (`sgp_engine` / `guarantee_amount` / `cell_mean` /
  `door_hybrid_calc` / `door_dead_pool` / `suppressed`) so the UI can
  badge the provenance and demote tier `A → B` when the historical band
  is wider than $1,000 (honest range display).

## API surface (under `/api`)

- `GET /shows` — past show list with joined artist/agent/deal/settlement.
- `GET /shows/:id` — full show detail (also used by the Settle wizard).
- `GET /shows/:id/export` — JSON export with per-show LLM summary.
- `GET /artists` — artist roster with deal-type and review-topic enrichment.
- `GET /reports` — KPI bundle for the Reports tab.
- `GET /deal-analysis` — full Deal Analysis bundle (complexity / size /
  profitability / costs / revenue.byDealType / revenue.months /
  revenue.crossTabBySizeAndType).
- `GET /needs-attention` — flat list of attention items.
- `POST /insights/enrich` — run the per-settlement summary pass; returns
  `{totalCandidates, enriched, skippedExisting, failed}`.
- `GET /insights` — cached cell grid with topKind + clustered bubbles.
- `GET /settings/llm` — read-only LLM status (no key material).
- `POST /settings/llm` — upsert provider/key/model; clears insights cache.

## Design documents

The redesign argument and the engineering reference for it both live as PDFs
in `exports/`:

| File | What it is |
|---|---|
| `exports/greenroom-settlement-redesign-v2.pdf` | **Settlement Redesign · v2.1** (May 2026). The opinionated three-phase argument — simplify the deal types Smart Switch already covers, then layer Improve-Deal caps and insurance on top. Every figure is sourced from the live API at this commit. |
| `exports/greenroom-settlement-redesign-v2.html` | HTML source of the redesign report (re-export with `python3 -c "from weasyprint import HTML; HTML('exports/greenroom-settlement-redesign-v2.html').write_pdf('exports/greenroom-settlement-redesign-v2.pdf')"`). |
| `exports/greenroom-supporting-document.pdf` | **Supporting Document · Features, APIs, and Tabs.** Engineering and analytical companion: every tab, every API endpoint, every backend lib module, with a direct mapping from each surface to the claim it supplies in the redesign report. |
| `exports/greenroom-supporting-document.html` | HTML source of the supporting document. |
| `exports/greenroom-insurance-pricing.pdf` | **Insurance Products 1 & 2 · Suggested Cost & Pricing** (May 2026). Pricing brief for the two Phase-3 insurance products. Per-show expected-cost derivation from live `/api/reports` (Product 1: 4.32% × $345 = $14.84/show) and the full 12-mo SGP backtest (Product 2: per-cap pricing table from n=156, median gap $870, p75 $1,569). Includes tier ladder, two-sided discount math, bundles, platform-level revenue model, sensitivity bands, and reserve recommendations. |
| `exports/greenroom-insurance-pricing.html` | HTML source of the insurance pricing brief. |

Older v1 PDFs were superseded by v2.1 and have been removed.

## Code-review bundle

`code-review/` is a self-contained snapshot of the live dataset (shows,
artists, per-deal extracted insights) plus a schema/purpose guide written
for an external code-review agent (Claude Code, etc.) so the prototype can
be reviewed without running the app. Regenerate with
`pnpm --filter @workspace/api-server exec tsx scripts/exportCodeReviewBundle.ts`.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **The API server bundles via esbuild.** After backend edits, restart the
  `artifacts/api-server: API Server` workflow before re-testing — HMR
  does not apply.
- **Insights coverage depends on enrichment.** Themes only appear for cells
  whose flagged deals already have a `negativeSummary`. If the Insights
  page looks empty, hit `POST /api/insights/enrich` (or set a key in
  Settings and re-trigger) and reload.
- **Saving Settings invalidates the insights cache.** Switching provider
  or model means the next `GET /api/insights` will re-cluster — expect a
  delay on the first call after a save.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
