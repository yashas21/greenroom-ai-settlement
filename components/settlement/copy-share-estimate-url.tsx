"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyShareEstimateUrl({ showId }: { showId: string }) {
  const [done, setDone] = useState(false);

  const copy = useCallback(() => {
    const path = `/shows/${showId}/settle/share`;
    const url = `${window.location.origin}${path}`;
    void navigator.clipboard.writeText(url).then(() => {
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    });
  }, [showId]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-[11px] h-7 text-ink-500 hover:text-ink-800"
      onClick={copy}
    >
      {done ? "Copied link" : "Copy share link"}
    </Button>
  );
}
