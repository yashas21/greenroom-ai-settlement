import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatShowDate, formatMoneyCompact } from "@/lib/format";
import {
  CommandPalette,
  type ShowEntry,
  type ArtistEntry,
} from "./command-palette";

const dealLabels: Record<string, string> = {
  flat: "Flat",
  percentage_of_gross: "% of gross",
  percentage_of_net: "% of net",
  vs: "Vs deal",
  door: "Door deal",
};

export function CommandPaletteData() {
  const [shows, setShows] = useState<ShowEntry[]>([]);
  const [artists, setArtists] = useState<ArtistEntry[]>([]);

  useEffect(() => {
    Promise.all([api.shows(), api.artists()])
      .then(([showRows, artistRows]) => {
        setShows(
          showRows.map(({ show, artist, deal }) => ({
            id: show.id,
            artistName: artist?.name ?? "Unknown Artist",
            dateFormatted: formatShowDate(show.date),
            dealType: deal ? (dealLabels[deal.dealType] ?? deal.dealType) : null,
            guaranteeFormatted:
              deal?.guaranteeAmount != null
                ? formatMoneyCompact(deal.guaranteeAmount)
                : null,
          })),
        );
        setArtists(
          artistRows.map(({ artist, showCount }) => ({
            name: artist.name,
            genre: artist.genre,
            showCount: Number(showCount),
          })),
        );
      })
      .catch(() => {});
  }, []);

  return <CommandPalette shows={shows} artists={artists} />;
}
