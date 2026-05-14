"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createShow, type CreateShowFormState } from "./actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import type { Artist, Venue } from "@/db/schema";

const inputClass =
  "w-full rounded-lg border border-ink-200/80 bg-white px-3 py-2 text-[13px] text-ink-900 shadow-sm placeholder:text-ink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 focus-visible:border-brand-500";

const labelClass = "block text-[11px] font-medium text-ink-500 uppercase tracking-[0.06em] mb-1.5";

export function CreateShowForm({
  defaultDate,
  venues,
  artists,
}: {
  defaultDate: string;
  venues: Venue[];
  artists: Artist[];
}) {
  const [state, formAction, pending] = useActionState<
    CreateShowFormState,
    FormData
  >(createShow, undefined);

  const [dealType, setDealType] = useState("flat");
  const [percentageBasis, setPercentageBasis] = useState<"gross" | "net">(
    "gross",
  );

  useEffect(() => {
    if (dealType === "percentage_of_gross") {
      setPercentageBasis("gross");
    }
    if (dealType === "percentage_of_net" || dealType === "vs") {
      setPercentageBasis("net");
    }
  }, [dealType]);

  const showPercentageBasis =
    dealType === "percentage_of_gross" ||
    dealType === "percentage_of_net" ||
    dealType === "vs";

  return (
    <div className="max-w-xl">
      <Link
        href="/shows"
        className="inline-flex items-center gap-1 text-[12px] text-ink-400 hover:text-ink-900 mb-8 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All shows
      </Link>

      <div className="mb-10">
        <div className="eyebrow mb-3">Prototype</div>
        <h1
          className="font-display text-[40px] font-medium text-ink-900 leading-[1.05]"
          style={{ letterSpacing: "-0.02em", fontOpticalSizing: "auto" }}
        >
          Add a show
        </h1>
        <p className="text-[14px] text-ink-500 mt-3 leading-relaxed">
          Creates the show, deal, and a placeholder ticket row, then opens
          settlement (including the estimate card). Use{" "}
          <strong className="text-ink-700">today or a past date</strong> so the
          show appears on the main Shows list — that view hides future dates.
        </p>
      </div>

      <form action={formAction} className="space-y-6">
        {state?.error && (
          <div className="rounded-lg border border-rose-200/60 bg-rose-50/40 px-4 py-3 text-[13px] text-rose-800 leading-relaxed">
            {state.error}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Show</CardTitle>
            <CardDescription>Venue, artist, schedule.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className={labelClass} htmlFor="venueId">
                Venue
              </label>
              <select
                id="venueId"
                name="venueId"
                required
                className={inputClass}
                defaultValue={venues[0]?.id ?? ""}
              >
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {v.city}, {v.state}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass} htmlFor="artistId">
                Existing artist
              </label>
              <select id="artistId" name="artistId" className={inputClass}>
                <option value="">— Select from roster —</option>
                {artists.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <p className="text-[11.5px] text-ink-400 mt-1.5 leading-snug">
                If you add a new name below, it is used instead of this
                dropdown.
              </p>
            </div>

            <div>
              <label className={labelClass} htmlFor="newArtistName">
                New artist name
              </label>
              <input
                id="newArtistName"
                name="newArtistName"
                type="text"
                className={inputClass}
                placeholder="Optional — creates a roster entry"
                autoComplete="off"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-1">
                <label className={labelClass} htmlFor="date">
                  Show date
                </label>
                <input
                  id="date"
                  name="date"
                  type="date"
                  required
                  className={inputClass}
                  defaultValue={defaultDate}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="doorsTime">
                  Doors
                </label>
                <input
                  id="doorsTime"
                  name="doorsTime"
                  type="text"
                  className={inputClass}
                  placeholder="8:00 PM"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="setTime">
                  Set
                </label>
                <input
                  id="setTime"
                  name="setTime"
                  type="text"
                  className={inputClass}
                  placeholder="9:00 PM"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Deal</CardTitle>
            <CardDescription>One deal per show — matches Mariana&apos;s workflow.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className={labelClass} htmlFor="dealType">
                Deal type
              </label>
              <select
                id="dealType"
                name="dealType"
                required
                className={inputClass}
                value={dealType}
                onChange={(e) => setDealType(e.target.value)}
              >
                <option value="flat">Flat guarantee</option>
                <option value="percentage_of_gross">Percentage of gross</option>
                <option value="percentage_of_net">Percentage of net</option>
                <option value="vs">Vs (guarantee vs % of net)</option>
                <option value="door">Door</option>
              </select>
            </div>

            {showPercentageBasis ? (
              <fieldset className="rounded-lg border border-ink-200/70 bg-canvas-soft/40 px-4 py-3">
                <legend className={labelClass + " px-1"}>
                  Percentage applies to
                </legend>
                <p className="text-[11.5px] text-ink-500 mb-3 leading-snug">
                  Gross = ticket gross before fees. Net = after ticket fees
                  {dealType === "percentage_of_gross"
                    ? " (no pass-through in this path)."
                    : "; then pass-through and caps feed the % side."}
                </p>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2.5 text-[13px] text-ink-800 cursor-pointer">
                    <input
                      type="radio"
                      name="percentageBasis"
                      value="gross"
                      className="accent-brand-700"
                      checked={percentageBasis === "gross"}
                      onChange={() => setPercentageBasis("gross")}
                    />
                    Gross box office
                  </label>
                  <label className="flex items-center gap-2.5 text-[13px] text-ink-800 cursor-pointer">
                    <input
                      type="radio"
                      name="percentageBasis"
                      value="net"
                      className="accent-brand-700"
                      checked={percentageBasis === "net"}
                      onChange={() => setPercentageBasis("net")}
                    />
                    Net (after ticket fees
                    {dealType !== "percentage_of_gross"
                      ? ", then expenses where modeled"
                      : ""}
                    )
                  </label>
                </div>
              </fieldset>
            ) : (
              <input type="hidden" name="percentageBasis" value="" />
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass} htmlFor="guaranteeAmount">
                  Guarantee ($)
                </label>
                <input
                  id="guaranteeAmount"
                  name="guaranteeAmount"
                  type="number"
                  min={0}
                  step="0.01"
                  className={inputClass}
                  placeholder="Flat / vs"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="percentage">
                  Percentage of gross/net (0–100)
                </label>
                <input
                  id="percentage"
                  name="percentage"
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  className={inputClass}
                  placeholder="e.g. 70"
                />
              </div>
            </div>

            <div>
              <label className={labelClass} htmlFor="expenseCap">
                Expense cap ($)
              </label>
              <input
                id="expenseCap"
                name="expenseCap"
                type="number"
                min={0}
                step="0.01"
                className={inputClass}
                placeholder="Optional — % of net / vs"
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="dealNotesFreetext">
                Deal notes (free text)
              </label>
              <textarea
                id="dealNotesFreetext"
                name="dealNotesFreetext"
                rows={3}
                className={`${inputClass} resize-y min-h-[80px]`}
                placeholder="What Mariana actually trusts…"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3 items-center flex-wrap">
          <Button type="submit" variant="brand" disabled={pending}>
            {pending ? "Creating…" : "Create show & open settlement"}
          </Button>
          <Link
            href="/shows"
            className="inline-flex h-9 items-center justify-center rounded-lg px-4 text-[13px] font-medium bg-white text-ink-900 hover:bg-ink-50 ring-1 ring-inset ring-ink-200/80 shadow-sm transition-all duration-150"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
