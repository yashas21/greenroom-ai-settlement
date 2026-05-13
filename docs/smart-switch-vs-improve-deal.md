# Smart Switch vs. Improve Deal

Both engines push deals toward simpler, less-disputed shapes, but they apply
to different deal universes and use different math.

---

## Smart Switch

**What it does.** Replaces a risky deal shape *wholesale* with a different
shape that pays the artist roughly the same expected amount but eliminates
settlement-night arithmetic.

**Where it applies (`switchAppliesTo`):**

| Deal type    | Bucket   | Switch shape proposed              |
| ------------ | -------- | ---------------------------------- |
| **Door**     | any size | Door hybrid (floor + capped split) |
| **Vs**       | $1–5K only | Flat                             |
| **% of net** | $1–5K only | Flat                             |
| anything else | —       | Not eligible                       |

**Formulation:**

- **Flat replacement** (vs / % of net in $1–5K) — preferred path routes
  through the **Smart Guaranteed Price** 7-step engine for the show,
  returning `g.suggestedPrice`. Fallback path uses the cell average:

  ```
  cell           = pastSettled[dealType][$1–5K]    // need cell.n ≥ 3, else no suggestion
  suggestedFlat  = roundTo50(cell.avgPayout)       // mean totalToArtist across the cell
  band           = [roundTo50(p10), roundTo50(p90)]
  ```

- **Door hybrid** (door, any bucket) — fixed-shape contract:

  ```
  floor          = $500
  splitPct       = 60%
  expenseCap     = min($1,500, round(cell.avgExpenses))
  projectedPool  = max(0, cell.avgGross × 0.9 − expenseCap)
  projectedPayout= floor + splitPct × projectedPool
  ```

- **Confidence tier** = `computeTier(cell.n, artistShowsAtVenue)`:

  ```
  cell.n ≥ 20 → A    cell.n ≥ 8 → B    cell.n ≥ 3 → C    else D
  if artistShowsAtVenue < 2 and tier == A → demote to B    // first-timers capped at B
  ```

---

## Improve Deal

**What it does.** Doesn't redraft the deal shape — instead surfaces
*individual line-item changes* the booker can apply and resend to the
agent (caps, hospitality limits, optional flat conversion).

**Where it applies (any non-flat upcoming deal — Smart Switch's complement
plus more):**

| Improvement              | Eligible deal types                                                          | All buckets? |
| ------------------------ | ---------------------------------------------------------------------------- | ------------ |
| **Add expense cap**      | vs · % of net · door (only if no `expenseCap` set)                           | yes          |
| **Add hospitality cap**  | any non-flat (only if no `hospitalityCap` set)                               | yes          |
| **Convert to flat**      | any non-flat with a Smart Guaranteed Price suggestion at confidence A or B   | yes          |

**Formulation:**

- **Expense cap** — bucketed defaults, paired with comparable median:

  ```
  default[$0–1K]=$800   $1–5K=$1,500   $5–15K=$3,500   $15K+=$7,500   Uncapped %=$1,500
  rationale = "Past {dealType} deals in {bucket} spent median ${medianExpenses} on billable
               expenses (n={comparableSettlements})."
  ```

- **Hospitality cap** — same shape:

  ```
  default[$0–1K]=$250   $1–5K=$500   $5–15K=$1,000   $15K+=$2,000   Uncapped %=$500
  ```

- **Convert to flat** — borrows the SGP suggestion directly
  (`sug.suggestedPrice`), only offered when `sug.confidenceTier ∈ {A, B}`.
  Rationale cites the bucket's historical dispute rate:

  ```
  disputeRate = comparableDisputes / comparableSettlements
  proposed    = sug.suggestedPrice
  ```

- **Comparables** are the same `dealType × bucket` cell used elsewhere
  (`classifyBucket` on the deal: `Uncapped %` if percentage and no
  guarantee, else binned $0–1K / $1–5K / $5–15K / $15K+).

---

## Quick map of who handles what

| Cell                          | Smart Switch       | Improve Deal     |
| ----------------------------- | ------------------ | ---------------- |
| Door, any size                | ✅ door hybrid     | ✅ caps          |
| Vs / % of net, $1–5K          | ✅ flat            | ✅ caps + flat   |
| Vs / % of net, other buckets  | —                  | ✅ caps + flat   |
| % of gross, any               | —                  | ✅ caps + flat   |
| Flat                          | —                  | — (no engine)    |

That's why the three filters on Shows are mutually exclusive:
**Improve Deal** = upcoming non-flat deals where Smart Switch *doesn't*
apply; **Smart Switch** = vs / % of net in $1–5K; **Smart Switch (Door)**
= all door deals.
