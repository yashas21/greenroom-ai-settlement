import { getVenues, getArtistsAlphabetical } from "@/lib/queries";
import { CreateShowForm } from "./create-show-form";

function defaultLocalDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default async function NewShowPage() {
  const [venues, artists] = await Promise.all([
    getVenues(),
    getArtistsAlphabetical(),
  ]);

  if (venues.length === 0) {
    return (
      <div className="px-12 py-10 max-w-xl">
        <p className="text-[13px] text-ink-600">
          No venues in the database. Run{" "}
          <code className="font-mono text-[12px]">npm run db:reset</code> first.
        </p>
      </div>
    );
  }

  return (
    <div className="px-12 py-10 max-w-7xl">
      <CreateShowForm
        defaultDate={defaultLocalDate()}
        venues={venues}
        artists={artists}
      />
    </div>
  );
}
