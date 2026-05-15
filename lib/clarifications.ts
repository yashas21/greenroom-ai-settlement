/**
 * Clarification persistence.
 *
 * Each detected `Flag` (from `dealParser.parseDeal`) can be resolved by
 * Mariana into one of three terminal states:
 *
 *   - `resolved`     — agent confirmed; ambiguity is now decided.
 *   - `acknowledged` — Mariana saw it, accepting the risk for this show.
 *   - `dismissed`    — false positive; parser was wrong.
 *
 * Open flags drive the Wednesday risk surface. Resolved/acknowledged/
 * dismissed flags drop off it.
 *
 * Stored as a single JSON file at `data/clarifications.json` rather than a
 * Drizzle table — keeps the diff small, plays nicely with `npm run db:reset`
 * (just delete the file to reset state), and the read/write volume here
 * is trivially small.
 */

import { promises as fs } from "fs";
import path from "path";

const FILE = path.resolve(process.cwd(), "data/clarifications.json");

export type ClarificationStatus = "open" | "resolved" | "acknowledged" | "dismissed";

export type ClarificationRecord = {
  status: ClarificationStatus;
  note?: string;
  resolvedAt: string; // ISO
};

type Store = Record<string, ClarificationRecord>;

async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

async function writeStore(store: Store): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(store, null, 2), "utf-8");
}

export async function getClarifications(
  flagIds: string[],
): Promise<Record<string, ClarificationRecord>> {
  const store = await readStore();
  const out: Record<string, ClarificationRecord> = {};
  for (const id of flagIds) {
    if (store[id]) out[id] = store[id];
  }
  return out;
}

export async function setClarification(
  flagId: string,
  status: ClarificationStatus,
  note?: string,
): Promise<void> {
  const store = await readStore();
  if (status === "open") {
    delete store[flagId];
  } else {
    store[flagId] = {
      status,
      note,
      resolvedAt: new Date().toISOString(),
    };
  }
  await writeStore(store);
}

export async function getAllClarifications(): Promise<Store> {
  return readStore();
}
