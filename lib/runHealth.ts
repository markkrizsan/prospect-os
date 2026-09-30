import type { RunMetrics } from "./types";

/** Missing or incomplete RUNS evidence is never interpreted as a target result. */
export function classifyRunHealth(run: RunMetrics | null, syncedAt: string, liveReady: number): string {
  if (!run) return "AWAITING FIRST RUN";
  const mode = run.mode.toUpperCase();
  if (mode.includes("STARTED") || mode.includes("IN PROGRESS")) {
    const startedAt = Date.parse(run.id);
    const now = Date.parse(syncedAt);
    return Number.isFinite(startedAt) && Number.isFinite(now) && now - startedAt > 15 * 60 * 1000
      ? "STALLED / NO TERMINAL REPORT"
      : "RUN IN PROGRESS";
  }
  if (mode.includes("FORENSIC") || mode.includes("INCOMPLETE") || mode.includes("FAILURE")) {
    return "INCOMPLETE / NO ACCEPTANCE";
  }
  if (/blocked/i.test(run.blocker) || /blocked/i.test(run.persistence)) return "PRODUCTION BLOCKED";
  if (run.readyAdded === null || run.readyEnd === null) return "UNVERIFIED / NO ACCEPTANCE";
  if (run.readyStart !== null && run.readyStart >= 10 && liveReady >= 10) return "BUFFER HEALTHY";
  return run.readyAdded >= 5 ? "TARGET MET" : "SHORT OF TARGET";
}
