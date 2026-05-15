# Greenroom — Seed Snapshot

This folder is the **portable data snapshot** for this fork of the Greenroom
case study. Anyone cloning the repo can reproduce the exact dataset the app
runs against without re-running any of the seed scripts.

## What's in here

| File | What it is |
|---|---|
| `greenroom.db` | Snapshot of the live SQLite database the API server reads from (`artifacts/api-server/data/greenroom.db`). |
| `artists.json` | The 5 demo artists added by `scripts/seedSmartSwitchDemo.ts` (2 "familiar", 3 first-timers). |
| `shows.json` | The 12 demo shows added by the same script (5 upcoming + 6 prior-show history rows used to give "familiar" artists a tier-A track record + 1 demo extra). |
| `deals.json` | The 12 demo deals attached to those shows (mix of vs / % of net / door / flat). |
| `settlements.json` | 6 settled prior shows that give the two "familiar" demo artists a tier-A track record at the venue. The 5 demo *upcoming* shows intentionally have no settlement yet. |
| `switch_suggestions.json` | Pre-generated Smart Switch suggestions for the demo upcoming shows (4 — one upcoming `% of net` deal is intentionally outside the eligible band). Two are pre-accepted (one flat, one door-hybrid) so `/shows?switched=1` has clean examples; two stay as `suggested` for the worklist. |
| `guarantee_suggestions.json` | Pre-generated Smart Guaranteed Price suggestions for the demo shows. |

## How this snapshot relates to the original starter

The original starter database lives at
[`samay-cbh/greenroom-starter/data/greenroom.db`](https://github.com/samay-cbh/greenroom-starter/blob/main/data/greenroom.db).
This fork's database is a **superset**:

| Table | Upstream | This fork | Delta | Source of delta |
|---|---:|---:|---:|---|
| `artists` | 59 | 64 | +5 | Demo seed (this folder) |
| `shows` | 537 | 549 | +12 | Demo seed (this folder) |
| `deals` | 537 | 549 | +12 | Demo seed (this folder) |
| `settlements` | 537 | 543 | +6 | Demo seed history rows (familiar artists' prior shows) |
| `expenses` | 2,943 | 2,943 | **0** | Unchanged |
| `comps` | 1,935 | 1,935 | **0** | Unchanged |
| `ticket_sales` | 537 | 537 | **0** | Unchanged |
| `switch_suggestions` | — | 12 | new table | Smart Switch feature |
| `guarantee_suggestions` | — | 28 | new table | Smart Guaranteed Price feature |
| `settings` | — | 4 | new table | LLM provider settings |

**The historical operational data (settlements, expenses, recoups, comps,
ticket sales) is byte-for-byte the original starter dataset** — every analytic
shown in the app (Reports, Deal Analysis, Disputes, Insights, Needs Attention)
runs against the same 537 settlements as the upstream starter. The demo
additions are all *upcoming* shows used to demo the Smart Switch + Smart
Guaranteed Price features and never roll up into historical KPIs.

## Recreating the dataset from scratch

If you'd rather rebuild instead of using the snapshot, the recipe is:

```bash
# 1. Drop in the upstream starter DB
curl -L -o artifacts/api-server/data/greenroom.db \
  https://raw.githubusercontent.com/samay-cbh/greenroom-starter/main/data/greenroom.db

# 2. Boot the API once so runtime migrations create the new tables
pnpm --filter @workspace/api-server run dev   # then ctrl-C

# 3. Apply the demo seed (idempotent)
pnpm --filter @workspace/api-server exec tsx scripts/seedSmartSwitchDemo.ts
```

That produces a database equivalent to `greenroom.db` in this folder.
