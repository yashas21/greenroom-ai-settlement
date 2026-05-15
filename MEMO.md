# Slice: Deal Sheet + Wednesday Risk View

> A 1.5-page PRD-quality memo. Greenroom Applied AI PM case study.
> Author: Sheharyar · May 2026 · Branch: `slice-c-deal-sheet-wednesday-view`

## TL;DR

Settlement starts on Wednesday, not at 2am. Most disputes are caused by ambiguities **already present in the deal email** the day it was signed — the venue and the agent just don't notice them until the room is empty and the tour bus is loading out. I built two surfaces:

1. **Deal Sheet** (`/shows/[id]/deal-sheet`) — parses `deal_notes_freetext` against the structured fields and a catalog of dispute-causing patterns. Each ambiguity becomes a flag with severity, evidence quote, suggested action, and a pre-drafted clarification email. Each can be **resolved**, **acknowledged**, or **dismissed** — and the trail of those decisions becomes the audit record that's missing today.
2. **Wednesday Risk View** (`/wednesday`) — every show with open flags, sorted by severity. Marcus's exact ask: *"I wish she could see, before a show even happens, whether the deal is going to be a clean one or a messy one."*

Hero demo path:
- `/wednesday` → see the Coastal Spell dispute surfaced as a sign-off mismatch (status: `disputed`, sign-off: "Looks good") + 8 high-severity flags across the corpus.
- Click into `show_coastal_spell_dispute` → 🔴 **"Marketing recoup — inside or outside the expense cap?"** flag, with evidence quoted from the prose, suggested action, and a draft email Mariana can copy-paste in 30 seconds.
- Click into `show_0000` (a clean flat deal) → 🟢 "Deal is settle-ready."

---

## Why this slice and not the others

The brief lists six adjacent slices: deal modeling, audit trails, real-time prediction, the 2am walkthrough, post-show agent comms, dispute resolution. I picked the **first two coupled into one**, and explicitly cut the others. Here's the reasoning.

**The signal in the research is loud and one-directional.** Every persona pointed to the same root cause:

> Sarah Kim (WME agent): *"The deal was a ghost. Mariana had her notes, I had my email, Andrea had her recollection… none of them perfectly agreed."*
>
> Mariana: *"Andrea's email was 80 words long and four of them were ambiguous and there's no version of the truth in our system."*
>
> Marcus (GM): *"I wish she could see, before a show even happens, whether the deal we agreed to is going to be a clean one or a messy one."*
>
> Diego (TM): *"That should never happen at the table — that should have been resolved when the deal was negotiated."*

Four interviews, one finding: **the 2am argument is downstream of the Tuesday email**. Building a better 2am calculator (Slice B) without fixing the deal capture is solving the symptom.

**The data agrees.**

| Validation | Number | Source |
|---|---|---|
| Deals where prose contradicts/extends structured fields | 86 of 537 (16%) reference bonus structures only in prose | direct query |
| Settlements with the brief's exact "disputed badge + positive sign-off" anti-pattern | 4 | direct query |
| Vs / %-net / door deals the in-app tool can't handle | 334 of 537 (62%) | direct query |
| Deals whose prose explicitly says the structured fields are stale | 1 ("structured field still reflects original $11,000 — confirm before settlement") | direct query — the data documents its own drift |

The leverage point is upstream. Fixing it removes a *class* of disputes; building a vs-deal calculator removes one stage of pain inside a single dispute.

**What about the Vs-deal calculator (Slice B)?** It is the more visible gap (Pri's 82%-on-spreadsheets number). I considered it first. I cut it because:
- It demos as "a clean settlement calculator" — exactly what the brief said you're *not* evaluating.
- Even with the calculator, the 2am conversation Mariana described still happens, because the inputs to the calculator are still ambiguous.
- A defensible cut: build the calculator *after* you've cleaned the inputs.

---

## What I built — the design choices

### 1. The parser (`lib/dealParser.ts`)

Reads `deal_notes_freetext` and emits `{ parsed: ParsedTerms, flags: Flag[] }`. The parser detects:

| Flag kind | Severity | Why it matters |
|---|---|---|
| `ambiguous_recoup_scope` | 🔴 high | The Coastal Spell case. Detected when prose mentions both a recoup and an expense cap with no scope qualifier (`inside`/`outside`/`in addition to`/`included in`). |
| `structured_field_conflict` | 🔴 high | Parsed value disagrees with structured DB column. The settlement engine uses structured; Mariana trusts prose; if they diverge, the math is already wrong. |
| `bonus_in_prose_only` | 🟡 medium | Prose mentions `+$X if gross > $Y` but `bonuses_json` is empty. The in-app tool will silently undercount the artist payout. |
| `walkout_pot_unsupported` | 🟡 medium | Schema has no representation; deal is unsettleable in-app. |
| `tier_ratchet_unsupported` | 🟡 medium | Engine treats it as a flat percentage. |
| `deal_drift_explicit` | 🔴 high | Prose itself says "structured field still reflects…" — the data documents its own drift. |
| `external_reference` | 🟡 medium | "see email thread" — the truth lives outside the system. |
| `missing_percentage_basis` | 🟡 medium | Percentage given but no gross/net. Difference is usually thousands. |

**Why deterministic and not an LLM?** In production this is a Claude/GPT call with structured output (the `ParsedTerms` shape acts as the JSON schema). For this prototype I encoded patterns deterministically because: (a) reviewer reproducibility — no API key required to run the demo, (b) the *interface* is what matters, not the kernel — same input, same shape of output, same UI consumes it. The memo below the interface is identical. Swapping in an LLM is a 30-line PR.

### 2. The Deal Sheet UI

Three columns, in priority order:
- **Left (largest):** Open flags as expanding cards. Each shows the message, evidence quote, suggested action, and — for high-severity ones — a **draft clarification email**. Below: a "Resolved & acknowledged" section that becomes the audit trail.
- **Right:** Side-by-side **structured ↔ prose** comparison. Conflicts highlighted in rose. Below it: a "found in prose only" list (walkout pots, recoups, off-system references — the things the schema doesn't model). Below that: the source prose Mariana actually trusts.
- **Hero header:** A traffic-light status (🟢 settle-ready / 🟡 attention / 🔴 blocked). The color is the answer to the question Marcus actually asks.

### 3. The Wednesday Risk View

Single page. Top: 4 summary stats. Then a dedicated "Status ↔ sign-off mismatch" card (the brief's breadcrumb, surfaced explicitly). Then "Shows with open ambiguities" sorted high → low. Then a "by kind" breakdown — *"where The Crescent's deal-capture process is leaking."*

I deliberately framed this as **"the deals that will fight you Friday night"** instead of a neutral "issues" list. The product taste is in the framing.

---

## What I cut — and why

| Cut | Why |
|---|---|
| Real LLM call | Reviewer reproducibility (no API key). The interface contract is preserved; the kernel swap is mechanical. Memo'd transparently in the UI itself. |
| Vs-deal settlement calculator | Symptom, not cause. Defensible as long as I'm explicit about it (this memo + the Loom). |
| Inline "send email" (mailto: integration) | The mailto link is a 5-minute add. Skipped to keep the demo offline-deterministic. UI shows a "draft to copy-paste" instead. |
| Persisting clarifications to a Drizzle table | Used a JSON file (`data/clarifications.json`) instead. Smaller diff, easier reset (`rm` it), trivial volume. Production: a `deal_clarifications` table with FK to `deals`. |
| Agent-side surface | The slice stops at "Mariana drafts email; Mariana sends from her own inbox." Sarah Kim explicitly asked for an agent-facing version (*"settlement becomes a structured collaboration"*) — that's the obvious v2. |
| Auto-running the parser on deal save and emitting the conflict at write-time | Prototype runs parser on read. Production: run on `deals.update`, persist flags, fire notifications. |
| Time-window filter for "next 14 days" on Wednesday | Demo data is all-past, so I show recent past. Real version would filter by `date BETWEEN today AND today + 14`. |
| Multi-venue, role-based permissions | Scope. |

---

## How I'd validate this

A short list, in the order I'd actually run them:

1. **The fastest signal: Mariana herself.** Walk her through the prototype on Coastal Spell + 5 random shows from her last month. The ask: *"Would you have caught this on Wednesday?"* Yes/no per flag. Target: 70%+ "yes, and I would have emailed the agent." Low cost, decisive read.
2. **Replay over 2025 disputes.** Take every settlement that escalated (recoup interpretation, expense overage, bonus mis-application) and ask: *did the parser flag it on the deal as it was signed?* Recall is the metric. Anything below ~60% means the catalog is too narrow.
3. **Friction A/B at one venue.** Pilot at The Crescent for one quarter. Hypothesis: settlements that started Wednesday with zero open flags take materially less time at the table (Mariana's stopwatch) and have lower next-day pushback rate (count of dispute emails per 100 settlements).
4. **Agent-side perception, before we build agent UI.** Email Sarah Kim and 2-3 other repeat agents: *"Here's a settlement where the deal was pre-cleared on Wednesday. Does this read different to you than the same venue normally does?"* Qualitative; we're hunting for the trust delta.
5. **False-positive rate.** Track `dismissed` outcomes per flag kind. If `ambiguous_recoup_scope` is dismissed >50% of the time, it's noise; we tune. If `structured_field_conflict` is dismissed often, the conflict definition is too loose.

---

## What I'd ship next (in priority order)

1. **LLM swap.** Replace the deterministic regex with a structured-output LLM call. Keep the catalog. Same UI. (1 week.)
2. **Auto-parse on deal save.** Move parsing from read-time to write-time; persist flags; show a banner on the dashboard when new flags appear. (1 week.)
3. **Email integration.** "Send clarification" actually composes via `mailto:` (or, with permission, sends through a connected mailbox). Tie incoming replies back to the flag. This is what closes the loop. (2 weeks.)
4. **Agent-facing micro-surface.** When Mariana sends a clarification, the agent gets a one-click confirm/correct page. Sarah's "structured collaboration" thesis. (3 weeks.)
5. **Vs-deal settlement engine.** *Now* build the calculator (Slice B). Inputs are clean. The 2am moment becomes mechanical. Use the Deal Sheet's parsed terms as the engine input — single source of truth. (3 weeks.)
6. **Dispute archive replay & catalog tuning.** Quarterly: re-run parser over closed disputes; surface kinds we missed; expand the catalog. The product gets smarter without any new features.

---

## Honest caveats

- The deterministic parser is **brittle by design** (regex over informal prose). It'll miss things an LLM wouldn't. The catalog of flag kinds is the durable artifact — the regex is throwaway.
- The "Wednesday view" surfaces past shows in this demo because seed data is all-past. Conceptually it's a forward-looking view; the date filter is a one-line change.
- The audit trail (resolved/acknowledged) currently lives in a JSON file. Fine for one venue, not fine for the platform. Trivial migration.
- I did not build the agent-facing piece. Sarah explicitly named it as the highest-leverage product change from her side. It's the obvious v2 — but cramming it into v1 would have made the slice less defensible, not more.
