"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { composeOutboundPacket, extractRecipientEmail, inView, outreachCopyIssues } from "@/lib/normalizeProspects";
import type { Prospect, ProspectData, ProspectView } from "@/lib/types";
import { classifyRunHealth } from "@/lib/runHealth";

const VIEWS: Array<{ id: ProspectView; label: string }> = [
  { id: "send-now", label: "SEND NOW" },
  { id: "market", label: "MARKET" },
  { id: "research", label: "RESEARCH" },
  { id: "hold", label: "HOLD" },
  { id: "sent", label: "SENT" },
  { id: "replied", label: "REPLIED" },
  { id: "all", label: "ALL" },
];

function cleanUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function present(value: string): string {
  return value || "Not recorded";
}

function isToday(value: string): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

function Intelligence({ label, value, tone = "plain" }: { label: string; value: string; tone?: string }) {
  return (
    <section className={`intel intel--${tone}`}>
      <h3>{label}</h3>
      <p>{present(value)}</p>
    </section>
  );
}

function SendFocus({
  item,
  index,
  total,
  busy,
  onNext,
  onPrev,
  onMarkSent,
  onReject,
  onNotice,
}: {
  item: Prospect;
  index: number;
  total: number;
  busy: boolean;
  onNext: () => void;
  onPrev: () => void;
  onMarkSent: (item: Prospect) => Promise<void>;
  onReject: (item: Prospect) => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const site = cleanUrl(item.website);
  const recipient = extractRecipientEmail(item.contactPath);
  const email = composeOutboundPacket(item);
  const copyIssues = [...outreachCopyIssues(item), ...(item.readyValidated ? [] : ["prospect is not currently READY"])];
  const copyBlocked = copyIssues.length > 0;

  const copyEmail = useCallback(async () => {
    if (!email || copyBlocked) return;
    await navigator.clipboard.writeText(email);
    onNotice(`${item.company || item.id}: recipient, subject and message copied`);
  }, [copyBlocked, email, item.company, item.id, onNotice]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      if (event.key === "ArrowRight") onNext();
      if (event.key === "ArrowLeft") onPrev();
      if (event.key.toLowerCase() === "c") void copyEmail();
      if (event.key.toLowerCase() === "z") window.open("https://mail.zoho.com/", "_blank", "noopener,noreferrer");
      if (event.key.toLowerCase() === "v" && site) window.open(site, "_blank", "noopener,noreferrer");
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [copyEmail, onNext, onPrev, site]);

  return (
    <article className="focus-card">
      <aside className="focus-index">
        <span>V10 / READY</span>
        <strong>{String(index + 1).padStart(2, "0")}</strong>
        <small>/ {String(total).padStart(2, "0")}</small>
        <div className="focus-index-rule" />
        <p>ONE PROSPECT<br />ONE DECISION</p>
      </aside>

      <section className="focus-main">
        <header className="focus-company">
          <div>
            <span className="micro-label">QUALIFIED OPPORTUNITY</span>
            <h2>{present(item.company)}</h2>
            <p>{[item.person, item.role, item.contactPath].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="focus-state">● {present(item.status)}</div>
        </header>

        <div className="focus-thesis">
          <span className="micro-label">WHY THIS DESERVES A SHOT</span>
          <div className="thesis-grid">
            <section>
              <b>01</b>
              <h3>REAL BUSINESS</h3>
              <p>{present(item.businessStrength)}</p>
            </section>
            <section>
              <b>02</b>
              <h3>REAL GAP</h3>
              <p>{present(item.commercialGap)}</p>
            </section>
            <section className="thesis-red">
              <b>03</b>
              <h3>THE MOVE</h3>
              <p>{present(item.interventionDelta)}</p>
            </section>
          </div>
        </div>

        <div className="focus-evidence">
          <div>
            <span>WHY IT COULD PAY</span>
            <p>{present(item.economicJustification)}</p>
          </div>
          <div>
            <span>WHY NOW</span>
            <p>{present(item.whyNow)}</p>
          </div>
        </div>

        <div className="focus-offer">
          <span>FIRST USEFUL THING</span>
          <strong>{present(item.microOffer)}</strong>
        </div>

        <div className="focus-bottom">
          <button onClick={onPrev} disabled={total <= 1}>← PREVIOUS</button>
          <span>{item.id}</span>
          <button onClick={onNext} disabled={total <= 1}>NEXT →</button>
        </div>
      </section>

      <aside className="focus-compose">
        <div className="compose-top">
          <span className="micro-label">OUTREACH / READY TO SEND</span>
          <strong>{present(item.subjectLine)}</strong>
          <p className="compose-recipient">TO / {recipient || "RECIPIENT EMAIL MISSING"}</p>
        </div>

        <div className="compose-draft">{present(item.outreachDraft)}</div>

        {copyBlocked && (
          <div className="copy-warning">
            <strong>COPY CHECK</strong>
            <span>{copyIssues.join(", ")}</span>
          </div>
        )}

        <div className="compose-actions">
          <button onClick={() => void copyEmail()} disabled={!email || copyBlocked}>COPY ALL <kbd>C</kbd></button>
          <a href="https://mail.zoho.com/" target="_blank" rel="noreferrer">OPEN ZOHO <kbd>Z</kbd></a>
          {site ? <a href={site} target="_blank" rel="noreferrer">VIEW SITE <kbd>V</kbd></a> : <button disabled>VIEW SITE</button>}
          <button className="reject" onClick={() => void onReject(item)} disabled={busy}>REJECT</button>
          <button className="mark-sent" onClick={() => void onMarkSent(item)} disabled={busy}>
            {busy ? "VERIFYING…" : "MARK SENT"}
          </button>
        </div>

        <div className="keyboard-hint">
          <span>← →</span> MOVE QUEUE
          <span>C</span> COPY ALL
          <span>Z</span> MAIL
          <span>V</span> SITE
        </div>
      </aside>
    </article>
  );
}

function ProspectCard({
  item,
  busy,
  onMarkSent,
  onReject,
  onNotice,
}: {
  item: Prospect;
  busy: boolean;
  onMarkSent: (item: Prospect) => Promise<void>;
  onReject: (item: Prospect) => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const site = cleanUrl(item.website);
  const email = composeOutboundPacket(item);
  const copyIssues = [...outreachCopyIssues(item), ...(item.readyValidated ? [] : ["prospect is not currently READY"])];
  const copyBlocked = copyIssues.length > 0;

  async function copyEmail() {
    if (!email || copyBlocked) return;
    await navigator.clipboard.writeText(email);
    onNotice(`${item.company || item.id}: recipient, subject and message copied`);
  }

  return (
    <article className="prospect-card">
      <header className="card-head">
        <div className="index">V10</div>
        <div className="card-identity">
          <span className="eyebrow">OPPORTUNITY RECORD</span>
          <h2>{present(item.company)}</h2>
          <p>{[item.person, item.role, item.id].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="status"><span>●</span> {present(item.status)}</div>
      </header>

      <div className="contact-strip">
        <div><span>WEBSITE</span><strong>{present(item.website)}</strong></div>
        <div><span>CONTACT PATH</span><strong>{present(item.contactPath)}</strong></div>
        <div><span>SOURCE</span><strong>{item.source} · {item.version || "V10"}</strong></div>
      </div>

      <div className="intelligence-grid">
        <Intelligence label="01 / BUSINESS STRENGTH" value={item.businessStrength} tone="strength" />
        <Intelligence label="02 / WEBSITE GAP" value={item.commercialGap} tone="gap" />
        <Intelligence label="03 / WHAT I WOULD CHANGE" value={item.interventionDelta} tone="delta" />
        <Intelligence label="04 / WHY IT COULD BE WORTH IT" value={item.economicJustification} />
        <Intelligence label="05 / WHY NOW" value={item.whyNow} />
        <Intelligence label="06 / SERVICE IDEA" value={item.serviceIdea} />
      </div>

      <section className="offer-band">
        <div><span>FIRST THING I CAN OFFER</span><strong>{present(item.microOffer)}</strong></div>
        <div><span>SUBJECT LINE</span><strong>{present(item.subjectLine)}</strong></div>
      </section>

      <section className="draft">
        <div className="draft-label"><span>OUTREACH</span><strong>READY TO COPY</strong></div>
        <p>{present(item.outreachDraft)}</p>
      </section>

      {copyBlocked && <div className="copy-warning"><strong>COPY CHECK</strong><span>{copyIssues.join(", ")}</span></div>}

      <footer className="actions">
        {site ? <a href={site} target="_blank" rel="noreferrer">VIEW SITE ↗</a> : <button disabled>VIEW SITE ↗</button>}
        <button onClick={() => void copyEmail()} disabled={!email || copyBlocked}>COPY ALL</button>
        <a href="https://mail.zoho.com/" target="_blank" rel="noreferrer">OPEN ZOHO ↗</a>
        <button className="reject" onClick={() => void onReject(item)} disabled={busy || Boolean(item.sentAt) || item.status.toLowerCase() === "rejected"}>REJECT</button>
        <button className="mark-sent" onClick={() => void onMarkSent(item)} disabled={busy || !item.readyValidated || Boolean(item.sentAt)}>
          {busy ? "VERIFYING…" : item.sentAt ? "SENT ✓" : "MARK SENT"}
        </button>
      </footer>
    </article>
  );
}

function MarketCard({ item }: { item: Prospect }) {
  const site = cleanUrl(item.website);

  return (
    <article className="market-row">
      <div className="market-number">MKT</div>
      <div className="market-core">
        <span className="eyebrow">{[item.cityState, item.industry].filter(Boolean).join(" / ")}</span>
        <h2>{present(item.company)}</h2>
        <p>{present(item.businessStrength)}</p>
      </div>
      <div className="market-signal">
        <span>DIGITAL SIGNAL</span>
        <p>{present(item.commercialGap)}</p>
      </div>
      <div className="market-state">
        <strong>{present(item.status)}</strong>
        <small>{present(item.signalStrength)}</small>
        {site && <a href={site} target="_blank" rel="noreferrer">OPEN ↗</a>}
      </div>
    </article>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<ProspectData | null>(null);
  const [view, setView] = useState<ProspectView>("send-now");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [locked, setLocked] = useState(false);
  const [dashboardKey, setDashboardKey] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const [reconciling, setReconciling] = useState(false);

  const request = useCallback(async (options?: RequestInit): Promise<ProspectData> => {
    const response = await fetch("/api/prospects", {
      ...options,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "x-dashboard-key": sessionStorage.getItem("prospect-os-key") ?? "",
      },
    });

    if (response.status === 401) {
      setLocked(true);
      throw new Error("Dashboard key required");
    }

    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Sheet sync failed");
    return body as ProspectData;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await request());
      setLocked(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Sheet sync failed";
      if (message !== "Dashboard key required") setError(message);
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const interval = window.setInterval(() => { void load(); }, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [load]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const records = useMemo(() => {
    const all = data?.prospects ?? [];
    const filtered = all.filter((item) => inView(item, view));
    const term = query.trim().toLowerCase();
    return term ? filtered.filter((item) => JSON.stringify(item).toLowerCase().includes(term)) : filtered;
  }, [data, query, view]);

  useEffect(() => {
    if (focusIndex >= records.length) setFocusIndex(Math.max(0, records.length - 1));
  }, [focusIndex, records.length]);

  const sentToday = useMemo(
    () => (data?.prospects ?? []).filter((item) => isToday(item.sentAt)).length,
    [data],
  );

  async function markSent(item: Prospect) {
    if (!window.confirm(`Mark ${item.company || item.id} as sent in the Google Sheet?`)) return;
    setBusyId(item.id);
    setError("");
    try {
      const next = await request({ method: "POST", body: JSON.stringify({ action: "MARK_SENT", id: item.id }) });
      setData(next);
      setNotice(`${item.company || item.id} confirmed SENT`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "MARK SENT failed");
    } finally {
      setBusyId("");
    }
  }

  async function rejectProspect(item: Prospect) {
    const reason = window.prompt(
      `Reject ${item.company || item.id}. Enter the real reason.`,
      "WEAK VALUE GAP",
    );
    if (!reason?.trim()) return;
    setBusyId(item.id);
    setError("");
    try {
      const next = await request({ method: "POST", body: JSON.stringify({ action: "REJECT", id: item.id, reason: reason.trim() }) });
      setData(next);
      setNotice(`${item.company || item.id} rejected`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "REJECT failed");
    } finally {
      setBusyId("");
    }
  }

  async function reconcileSent() {
    if (!window.confirm("Repair existing SENT records in PIPELINE and conditional follow-up dates? No emails will be sent.")) return;
    setReconciling(true);
    setError("");
    try {
      const next = await request({ method: "POST", body: JSON.stringify({ action: "SYNC_SENT" }) });
      setData(next);
      setNotice("SENT follow-ups and PIPELINE records reconciled");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "SENT reconciliation failed");
    } finally {
      setReconciling(false);
    }
  }

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    sessionStorage.setItem("prospect-os-key", dashboardKey);
    await load();
  }

  const activeView = VIEWS.find((item) => item.id === view)?.label ?? "SEND NOW";
  const readyCount = data?.counts["send-now"] ?? 0;
  const run = data?.latestRun;
  const runState = classifyRunHealth(run ?? null, data?.syncedAt ?? new Date().toISOString(), readyCount);

  return (
    <>
      {locked && (
        <div className="lock">
          <form onSubmit={unlock}>
            <span>PROSPECT OS / PRIVATE</span>
            <h1>ENTER<br />SYSTEM</h1>
            <label htmlFor="dashboard-key">Dashboard key</label>
            <input id="dashboard-key" type="password" value={dashboardKey} onChange={(event) => setDashboardKey(event.target.value)} autoFocus />
            <button>ENTER</button>
          </form>
        </div>
      )}

      <header className="command-head">
        <div className="command-brand">
          <span>PROSPECT<br />OS</span>
          <strong>10</strong>
        </div>
        <div className="command-title">
          <span>CONVERSATION ENGINE / LIVE</span>
          <h1>{view === "send-now" ? <>SEND <em>NOW</em></> : activeView}</h1>
        </div>
        <div className="command-metrics">
          <div><span>READY</span><strong>{String(readyCount).padStart(2, "0")}</strong><small>/ 15 BUFFER</small></div>
          <div><span>SENT TODAY</span><strong>{String(sentToday).padStart(2, "0")}</strong><small>HUMAN CONTROLLED</small></div>
        </div>
      </header>

      <nav className="view-nav" aria-label="Prospect views">
        {VIEWS.map((item) => (
          <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => { setView(item.id); setFocusIndex(0); }}>
            {item.label}<sup>{data?.counts[item.id] ?? 0}</sup>
          </button>
        ))}
        <label>
          <span className="sr-only">Search prospects</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="SEARCH /" />
        </label>
        <button className="refresh" onClick={() => void reconcileSent()} disabled={reconciling || loading}>{reconciling ? "REPAIRING…" : "REPAIR FOLLOW-UPS ↻"}</button>
        <button className="refresh" onClick={() => void load()} disabled={loading || reconciling}>{loading ? "SYNCING…" : "REFRESH ↻"}</button>
      </nav>

      <section className="run-strip" aria-label="Last hourly production run">
        <div><span>LATEST CYCLE</span><strong>{run?.localTime || "NOT YET RECORDED"}</strong></div>
        <div><span>VERIFIED NEW READY / 05</span><strong>{run?.readyAdded ?? "—"} / 05</strong></div>
        <div><span>SCREENED / DEEP AUDITS</span><strong>{run ? `${run.screened ?? "—"} / ${run.audited ?? "—"}` : "— / —"}</strong></div>
        <div><span>ACCEPTANCE</span><strong>{runState}</strong></div>
        <div className="run-blocker"><span>BOTTLENECK</span><strong>{run?.blocker || "Awaiting RUNS readback"}</strong></div>
      </section>

      <main className={view === "send-now" ? "main-focus" : ""}>
        {Boolean(data?.consistencyIssues?.length) && (
          <div className="error" role="status">
            <strong>DATA INTEGRITY</strong>
            <span>{data?.consistencyIssues.length} source inconsistencies detected. Conflicted records are excluded from SEND NOW.
              Review the matching IDs in OPPORTUNITIES and OUTREACH before preparing new outreach.</span>
          </div>
        )}
        {error && <div className="error" role="alert"><strong>SYSTEM</strong><span>{error}</span></div>}

        {view === "send-now" && !loading && !error && records.length > 0 && (
          <SendFocus
            item={records[focusIndex]}
            index={focusIndex}
            total={records.length}
            busy={busyId === records[focusIndex].id}
            onNext={() => setFocusIndex((current) => (current + 1) % records.length)}
            onPrev={() => setFocusIndex((current) => (current - 1 + records.length) % records.length)}
            onMarkSent={markSent}
            onReject={rejectProspect}
            onNotice={setNotice}
          />
        )}

        {view === "send-now" && !loading && !error && records.length === 0 && (
          <section className="empty-focus">
            <span>00</span>
            <h2>QUEUE<br />EMPTY</h2>
            <p>No unsent READY record is currently available. Replenishment is the hourly production priority; review the last run for sourcing or persistence blockers.</p>
          </section>
        )}

        {view !== "send-now" && (
          <>
            <div className="queue-head">
              <div><span>LIVE VIEW</span><h2>{activeView}</h2></div>
              <div><span>RECORDS</span><strong>{String(records.length).padStart(2, "0")}</strong></div>
              <div><span>LAST SYNC</span><strong>{data?.syncedAt ? new Date(data.syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</strong></div>
            </div>

            {!loading && !error && records.length === 0 && (
              <section className="empty"><span>00</span><h2>NO RECORDS<br />IN THIS VIEW</h2></section>
            )}

            <div className="prospect-list">
              {records.map((item) =>
                item.source.toLowerCase() === "market"
                  ? <MarketCard key={item.id || `${item.company}-market`} item={item} />
                  : <ProspectCard key={item.id || `${item.company}-${item.person}`} item={item} busy={busyId === item.id} onMarkSent={markSent} onReject={rejectProspect} onNotice={setNotice} />
              )}
            </div>
          </>
        )}
      </main>

      <footer className="system-footer">
        <span>GOOGLE SHEETS / SINGLE SOURCE OF TRUTH</span>
        <span>← → NAVIGATE / C COPY ALL / Z MAIL / V SITE</span>
        <span>V10 / EXECUTION INTERFACE</span>
      </footer>

      <div className="sr-only" aria-live="polite">{notice}</div>
      {notice && <div className="toast">{notice}</div>}
    </>
  );
}
