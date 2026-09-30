"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Prospect, ProspectData, ProspectView } from "@/lib/types";

const VIEWS: Array<{ id: ProspectView; label: string }> = [
  { id: "send-now", label: "SEND NOW" },
  { id: "research", label: "RESEARCH" },
  { id: "sent", label: "SENT" },
  { id: "replied", label: "REPLIED" },
  { id: "all", label: "ALL" },
];

function cleanUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch { return null; }
}

function present(value: string): string {
  return value || "Not recorded";
}

function Intelligence({ label, value, tone = "plain" }: { label: string; value: string; tone?: string }) {
  return <section className={`intel intel--${tone}`}><h3>{label}</h3><p>{present(value)}</p></section>;
}

function ProspectCard({ item, busy, onMarkSent, onReject, onNotice }: {
  item: Prospect;
  busy: boolean;
  onMarkSent: (item: Prospect) => Promise<void>;
  onReject: (item: Prospect) => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const site = cleanUrl(item.website);
  const zoho = "https://mail.zoho.com/";
  const legacyId = item.id.toLowerCase().startsWith("v9") ? `LEGACY ID · ${item.id}` : item.id ? `ID · ${item.id}` : "";
  const email = [item.subjectLine ? `Subject: ${item.subjectLine}` : "", item.outreachDraft].filter(Boolean).join("\n\n");

  async function copyEmail() {
    if (!email) return;
    await navigator.clipboard.writeText(email);
    onNotice(`${item.company || item.id} email copied`);
  }

  return (
    <article className="prospect-card">
      <header className="card-head">
        <div className="index">V10</div>
        <div>
          <h2>{present(item.company)}</h2>
          <p>{present(item.person)}{item.role ? ` · ${item.role}` : ""}{legacyId ? ` · ${legacyId}` : ""}</p>
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
        <Intelligence label="02 / DIGITAL / COMMERCIAL GAP" value={item.commercialGap} tone="gap" />
        <Intelligence label="03 / MARK INTERVENTION DELTA" value={item.interventionDelta} tone="delta" />
        <Intelligence label="04 / ECONOMIC JUSTIFICATION" value={item.economicJustification} />
        <Intelligence label="05 / WHY NOW / TRIGGER" value={item.whyNow} />
        <Intelligence label="06 / SERVICE IDEA" value={item.serviceIdea} />
      </div>

      <section className="offer-band">
        <div><span>MICRO-OFFER</span><strong>{present(item.microOffer)}</strong></div>
        <div><span>SUBJECT LINE</span><strong>{present(item.subjectLine)}</strong></div>
      </section>

      <section className="draft">
        <div className="draft-label">FINISHED OUTREACH DRAFT</div>
        <p>{present(item.outreachDraft)}</p>
      </section>

      <footer className="actions">
        {site ? <a href={site} target="_blank" rel="noreferrer">VIEW SITE ↗</a> : <button disabled>VIEW SITE ↗</button>}
        <button onClick={() => void copyEmail()} disabled={!email}>COPY EMAIL</button>
        <a href={zoho} target="_blank" rel="noreferrer">OPEN ZOHO ↗</a>
        <button className="reject" onClick={() => void onReject(item)} disabled={busy || Boolean(item.sentAt) || item.status.toLowerCase() === "rejected"}>
          REJECT
        </button>
        <button className="mark-sent" onClick={() => void onMarkSent(item)} disabled={busy || Boolean(item.sentAt)}>
          {busy ? "VERIFYING…" : item.sentAt ? "SENT ✓" : "MARK SENT"}
        </button>
      </footer>
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

  const request = useCallback(async (options?: RequestInit): Promise<ProspectData> => {
    const response = await fetch("/api/prospects", {
      ...options,
      cache: "no-store",
      headers: { "Content-Type": "application/json", "x-dashboard-key": sessionStorage.getItem("prospect-os-key") ?? "" },
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
    try { setData(await request()); setLocked(false); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : "Sheet sync failed";
      if (message !== "Dashboard key required") setError(message);
    } finally { setLoading(false); }
  }, [request]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const records = useMemo(() => {
    const all = data?.prospects ?? [];
    const inView = all.filter((item) => {
      const status = item.status.toLowerCase();
      if (view === "send-now") return (item.version.toLowerCase() === "v10" || item.version === "10" || item.id.toLowerCase().startsWith("v10") || status.startsWith("v10 ")) && ["outreach", "opportunities"].includes(item.source.toLowerCase()) && ["ready", "ready to send", "v10 ready"].includes(status) && !item.sentAt;
      if (view === "research") return status.includes("research");
      if (view === "sent") return Boolean(item.sentAt) || status === "sent";
      if (view === "replied") return Boolean(item.repliedAt) || status.includes("replied") || status === "reply";
      return true;
    });
    const term = query.trim().toLowerCase();
    return term ? inView.filter((item) => JSON.stringify(item).toLowerCase().includes(term)) : inView;
  }, [data, query, view]);

  async function markSent(item: Prospect) {
    if (!window.confirm(`Mark ${item.company || item.id} as sent in the Google Sheet?`)) return;
    setBusyId(item.id);
    setError("");
    try {
      const next = await request({ method: "POST", body: JSON.stringify({ action: "MARK_SENT", id: item.id }) });
      setData(next);
      setNotice(`${item.company || item.id} confirmed SENT in Google Sheets`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "MARK SENT failed"); }
    finally { setBusyId(""); }
  }

  async function rejectProspect(item: Prospect) {
    const reason = window.prompt(
      `Reject ${item.company || item.id}. Enter a concise reason (for example: SCOPE COMPLEXITY, WEAK VALUE GAP, ALREADY SOLVED, NO ACCESS, LOW ECONOMICS).`,
      "SCOPE COMPLEXITY",
    );
    if (!reason?.trim()) return;
    setBusyId(item.id);
    setError("");
    try {
      const next = await request({ method: "POST", body: JSON.stringify({ action: "REJECT", id: item.id, reason: reason.trim() }) });
      setData(next);
      setNotice(`${item.company || item.id} rejected: ${reason.trim()}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "REJECT failed"); }
    finally { setBusyId(""); }
  }

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    sessionStorage.setItem("prospect-os-key", dashboardKey);
    await load();
  }

  return (
    <>
      {locked && <div className="lock"><form onSubmit={unlock}><span>PROSPECT OS / V10</span><h1>PRIVATE<br />COMMAND</h1><label htmlFor="dashboard-key">Dashboard key</label><input id="dashboard-key" type="password" value={dashboardKey} onChange={(event) => setDashboardKey(event.target.value)} autoFocus /><button>ENTER</button></form></div>}
      <header className="masthead">
        <div className="brand"><span>PROSPECT OS</span><b>10</b></div>
        <div className="edition">CONVERSATION ENGINE V10<br />GOOGLE SHEETS / LIVE</div>
        <h1>SEND<br /><em>NOW</em></h1>
        <div className="masthead-meta"><strong>{String(data?.counts["send-now"] ?? 0).padStart(2, "0")}</strong><span>V10 READY<br />FOR ACTION</span></div>
      </header>

      <nav className="view-nav" aria-label="Prospect views">
        {VIEWS.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}>{item.label} <sup>{data?.counts[item.id] ?? 0}</sup></button>)}
        <label><span className="sr-only">Search prospects</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="SEARCH /" /></label>
        <button className="refresh" onClick={() => void load()} disabled={loading}>{loading ? "SYNCING…" : "REFRESH ↻"}</button>
      </nav>

      <main>
        <div className="queue-head"><div><span>ACTIVE VIEW</span><h2>{VIEWS.find((item) => item.id === view)?.label}</h2></div><div><span>RECORDS</span><strong>{String(records.length).padStart(2, "0")}</strong></div><div><span>LAST SYNC</span><strong>{data?.syncedAt ? new Date(data.syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</strong></div></div>
        {error && <div className="error" role="alert"><strong>SHEET CONNECTION</strong><span>{error}</span></div>}
        {!loading && !error && records.length === 0 && <section className="empty"><span>00</span><h2>NO RECORDS<br />IN THIS VIEW</h2><p>Synchronized from the Google Sheet. Nothing has been copied into another database.</p></section>}
        <div className="prospect-list">{records.map((item) => <ProspectCard key={item.id || `${item.company}-${item.person}`} item={item} busy={busyId === item.id} onMarkSent={markSent} onReject={rejectProspect} onNotice={setNotice} />)}</div>
      </main>
      <footer className="system-footer"><span>SINGLE SOURCE OF TRUTH → GOOGLE SHEETS</span><span>V10 / EXECUTION INTERFACE</span></footer>
      <div className="sr-only" aria-live="polite">{notice}</div>
      {notice && <div className="toast">{notice}</div>}
    </>
  );
}
