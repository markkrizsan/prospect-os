"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { inView, outreachQualityIssues } from "@/lib/normalizeProspects";
import type { Prospect, ProspectData, ProspectView } from "@/lib/types";

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

function Intelligence({ label, value, tone = "plain" }: { label: string; value: string; tone?: string }) {
  return (
    <section className={`intel intel--${tone}`}>
      <h3>{label}</h3>
      <p>{present(value)}</p>
    </section>
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
  const zoho = "https://mail.zoho.com/";
  const legacyId = item.id.toLowerCase().startsWith("v9")
    ? `LEGACY ID · ${item.id}`
    : item.id
      ? `ID · ${item.id}`
      : "";
  const email = [item.subjectLine ? `Subject: ${item.subjectLine}` : "", item.outreachDraft]
    .filter(Boolean)
    .join("\n\n");
  const copyIssues = outreachQualityIssues(item);
  const copyBlocked = copyIssues.length > 0;

  async function copyEmail() {
    if (!email) return;
    await navigator.clipboard.writeText(email);
    onNotice(`${item.company || item.id} email copied`);
  }

  return (
    <article className="prospect-card">
      <header className="card-head">
        <div className="index">V10</div>
        <div className="card-identity">
          <span className="eyebrow">QUALIFIED OPPORTUNITY</span>
          <h2>{present(item.company)}</h2>
          <p>
            {present(item.person)}
            {item.role ? ` · ${item.role}` : ""}
            {legacyId ? ` · ${legacyId}` : ""}
          </p>
        </div>
        <div className="status">
          <span aria-hidden="true">●</span> {present(item.status)}
        </div>
      </header>

      <div className="contact-strip">
        <div>
          <span>WEBSITE</span>
          <strong>{present(item.website)}</strong>
        </div>
        <div>
          <span>CONTACT PATH</span>
          <strong>{present(item.contactPath)}</strong>
        </div>
        <div>
          <span>SOURCE</span>
          <strong>{item.source} · {item.version || "V10"}</strong>
        </div>
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
        <div>
          <span>FIRST THING I CAN OFFER</span>
          <strong>{present(item.microOffer)}</strong>
        </div>
        <div>
          <span>SUBJECT LINE</span>
          <strong>{present(item.subjectLine)}</strong>
        </div>
      </section>

      <section className="draft">
        <div className="draft-label">
          <span>OUTREACH</span>
          <strong>READY TO COPY</strong>
        </div>
        <p>{present(item.outreachDraft)}</p>
      </section>

      {copyBlocked && (
        <div className="copy-warning" role="alert">
          <strong>COPY CHECK</strong>
          <span>Rewrite before sending: {copyIssues.join(", ")}</span>
        </div>
      )}

      <footer className="actions">
        {site ? (
          <a href={site} target="_blank" rel="noreferrer">VIEW SITE ↗</a>
        ) : (
          <button disabled>VIEW SITE ↗</button>
        )}
        <button
          onClick={() => void copyEmail()}
          disabled={!email || copyBlocked}
          title={copyBlocked ? `Fix copy first: ${copyIssues.join(", ")}` : undefined}
        >
          COPY EMAIL
        </button>
        <a href={zoho} target="_blank" rel="noreferrer">OPEN ZOHO ↗</a>
        <button
          className="reject"
          onClick={() => void onReject(item)}
          disabled={busy || Boolean(item.sentAt) || item.status.toLowerCase() === "rejected"}
        >
          REJECT
        </button>
        <button
          className="mark-sent"
          onClick={() => void onMarkSent(item)}
          disabled={busy || Boolean(item.sentAt)}
        >
          {busy ? "VERIFYING…" : item.sentAt ? "SENT ✓" : "MARK SENT"}
        </button>
      </footer>
    </article>
  );
}

function MarketCard({ item }: { item: Prospect }) {
  const site = cleanUrl(item.website);

  return (
    <article className="prospect-card market-card">
      <header className="card-head">
        <div className="index">MKT</div>
        <div className="card-identity">
          <span className="eyebrow">MARKET INTELLIGENCE</span>
          <h2>{present(item.company)}</h2>
          <p>{[item.cityState, item.industry, item.id].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="status">
          <span aria-hidden="true">●</span> {present(item.status)}
        </div>
      </header>

      <div className="contact-strip">
        <div>
          <span>WEBSITE</span>
          <strong>{present(item.website)}</strong>
        </div>
        <div>
          <span>SIGNAL STRENGTH</span>
          <strong>{present(item.signalStrength)}</strong>
        </div>
        <div>
          <span>SOURCE</span>
          <strong>MARKET</strong>
        </div>
      </div>

      <div className="intelligence-grid">
        <Intelligence label="01 / BUSINESS SIGNAL" value={item.businessStrength} tone="strength" />
        <Intelligence label="02 / DIGITAL SIGNAL" value={item.commercialGap} tone="gap" />
        <Intelligence label="03 / ECONOMICS" value={item.economicJustification} tone="delta" />
        <Intelligence label="04 / OFFER LANE" value={item.serviceIdea} />
        <Intelligence label="05 / SCREENING REASON" value={item.screeningReason} />
        <Intelligence label="06 / NOTES" value={item.notes} />
      </div>

      <footer className="actions market-actions">
        {site ? <a href={site} target="_blank" rel="noreferrer">VIEW SITE ↗</a> : <button disabled>VIEW SITE ↗</button>}
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

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void load();
    }, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const records = useMemo(() => {
    const all = data?.prospects ?? [];
    const inViewRecords = all.filter((item) => inView(item, view));
    const term = query.trim().toLowerCase();
    return term
      ? inViewRecords.filter((item) => JSON.stringify(item).toLowerCase().includes(term))
      : inViewRecords;
  }, [data, query, view]);

  async function markSent(item: Prospect) {
    if (!window.confirm(`Mark ${item.company || item.id} as sent in the Google Sheet?`)) return;
    setBusyId(item.id);
    setError("");

    try {
      const next = await request({
        method: "POST",
        body: JSON.stringify({ action: "MARK_SENT", id: item.id }),
      });
      setData(next);
      setNotice(`${item.company || item.id} confirmed SENT in Google Sheets`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "MARK SENT failed");
    } finally {
      setBusyId("");
    }
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
      const next = await request({
        method: "POST",
        body: JSON.stringify({ action: "REJECT", id: item.id, reason: reason.trim() }),
      });
      setData(next);
      setNotice(`${item.company || item.id} rejected: ${reason.trim()}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "REJECT failed");
    } finally {
      setBusyId("");
    }
  }

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    sessionStorage.setItem("prospect-os-key", dashboardKey);
    await load();
  }

  const activeView = VIEWS.find((item) => item.id === view)?.label ?? "SEND NOW";

  return (
    <>
      {locked && (
        <div className="lock">
          <form onSubmit={unlock}>
            <span>PROSPECT OS / V10</span>
            <h1>PRIVATE<br />COMMAND</h1>
            <label htmlFor="dashboard-key">Dashboard key</label>
            <input
              id="dashboard-key"
              type="password"
              value={dashboardKey}
              onChange={(event) => setDashboardKey(event.target.value)}
              autoFocus
            />
            <button>ENTER</button>
          </form>
        </div>
      )}

      <header className="masthead">
        <div className="brand">
          <span>PROSPECT OS</span>
          <b>10</b>
        </div>

        <div className="edition">
          <span>CONVERSATION ENGINE / V10</span>
          <strong>GOOGLE SHEETS<br />LIVE SYSTEM</strong>
        </div>

        <div className="masthead-title">
          <span className="masthead-kicker">OUTBOUND / OPERATING SYSTEM</span>
          <h1>SEND<br /><em>NOW</em></h1>
          <div className="signal-rule" aria-hidden="true"><i /></div>
        </div>

        <div className="masthead-meta">
          <span>READY / NOW</span>
          <strong>{String(data?.counts["send-now"] ?? 0).padStart(2, "0")}</strong>
          <small>V10 VERIFIED<br />FOR ACTION</small>
        </div>
      </header>

      <nav className="view-nav" aria-label="Prospect views">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            className={view === item.id ? "active" : ""}
            onClick={() => setView(item.id)}
          >
            <span>{item.label}</span>
            <sup>{data?.counts[item.id] ?? 0}</sup>
          </button>
        ))}
        <label>
          <span className="sr-only">Search prospects</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="SEARCH /"
          />
        </label>
        <button className="refresh" onClick={() => void load()} disabled={loading}>
          {loading ? "SYNCING…" : "REFRESH ↻"}
        </button>
      </nav>

      <main>
        <div className="queue-head">
          <div>
            <span>ACTIVE VIEW / LIVE QUEUE</span>
            <h2>{activeView}</h2>
          </div>
          <div>
            <span>RECORDS</span>
            <strong>{String(records.length).padStart(2, "0")}</strong>
          </div>
          <div>
            <span>LAST SYNC</span>
            <strong>
              {data?.syncedAt
                ? new Date(data.syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                : "—"}
            </strong>
          </div>
        </div>

        {error && (
          <div className="error" role="alert">
            <strong>SHEET CONNECTION</strong>
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && records.length === 0 && (
          <section className="empty">
            <span>00</span>
            <h2>NO RECORDS<br />IN THIS VIEW</h2>
            <p>Synchronized from the Google Sheet. Nothing has been copied into another database.</p>
          </section>
        )}

        <div className="prospect-list">
          {records.map((item) =>
            item.source.toLowerCase() === "market" ? (
              <MarketCard key={item.id || `${item.company}-market`} item={item} />
            ) : (
              <ProspectCard
                key={item.id || `${item.company}-${item.person}`}
                item={item}
                busy={busyId === item.id}
                onMarkSent={markSent}
                onReject={rejectProspect}
                onNotice={setNotice}
              />
            ),
          )}
        </div>
      </main>

      <footer className="system-footer">
        <span>SINGLE SOURCE OF TRUTH → GOOGLE SHEETS</span>
        <span>V10 / EXECUTION INTERFACE</span>
      </footer>

      <div className="sr-only" aria-live="polite">{notice}</div>
      {notice && <div className="toast">{notice}</div>}
    </>
  );
}
