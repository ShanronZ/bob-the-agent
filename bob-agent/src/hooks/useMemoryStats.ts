import { useEffect, useState } from "react";
import { fetchMemoryStats, type MemoryStats } from "../lib/memoryClient";

// Refetches on an interval so the dashboard's all-time tile stays roughly
// current while it's open, without needing a push mechanism.
export function useMemoryStats(active: boolean): MemoryStats | null {
  const [stats, setStats] = useState<MemoryStats | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const load = () => {
      fetchMemoryStats()
        .then((s) => {
          if (!cancelled) setStats(s);
        })
        .catch((err) => console.error("failed to load memory stats", err));
    };

    load();
    const interval = window.setInterval(load, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [active]);

  return stats;
}
