/**
 * The page, as a pure function of a snapshot.
 *
 * SEPARATE FROM server.ts SO IT CAN BE IMPORTED WITHOUT STARTING A SERVER.
 * The first version of this had `esc` living next to `createServer(...)` and
 * `server.listen(...)` at module scope, so importing it from a test bound port
 * 8787 as a side effect of asking whether a `<` came out escaped. On a box
 * where several agents run the suite at once that is a port collision arriving
 * as an unrelated red test.
 */
import { formatWait } from "../../scripts/gjd-remote-tmux.js";
import type { FleetSnapshot } from "./collect.js";
import { triageCounts, triageSort, type FleetStatus } from "./status.js";

/**
 * Escape for HTML text and attributes.
 *
 * Every field on this page is written by an agent — a title, a repo, a
 * directory — so it is untrusted text, and a title containing markup would
 * otherwise run as script in the one browser session that can see the fleet.
 * The ampersand goes first: escaping it after the angle brackets turns the
 * `&lt;` we just produced back into a `<`.
 */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * How old the snapshot is, and whether to believe it.
 *
 * `now` is a parameter rather than a call to `Date.now()` so the test can say
 * what time it is. Age is the whole reason this line exists: a page that cannot
 * say when it was collected is indistinguishable from one that is up to date.
 */
export function ageLine(snap: FleetSnapshot | null, error: string | null, now = Date.now()): string {
  if (!snap) return error ? `no snapshot yet — ${esc(error)}` : "collecting…";
  const secs = Math.max(0, Math.round((now - Date.parse(snap.collectedAt)) / 1000));
  const age = secs < 60 ? `${secs}s ago` : `${Math.round(secs / 60)}m ago`;
  return error ? `${age} — STALE, last refresh failed: ${esc(error)}` : age;
}

/**
 * How a status reads on the page, and which colour band it gets.
 *
 * `unknown` shows its reason rather than a shrug. That is the whole point of
 * carrying one: a row nobody could ask about must not look like a quiet one.
 */
export function statusLabel(s: FleetStatus): { text: string; cls: string } {
  switch (s.kind) {
    case "needs-you":
      return { text: "needs you", cls: "needs" };
    case "working":
      return { text: "working", cls: "work" };
    case "idle":
      return { text: "idle", cls: "idle" };
    case "waiting":
      return { text: `waiting ${formatWait(s.secondsLeft)}`, cls: "idle" };
    case "no-claude":
      return { text: "no agent", cls: "idle" };
    case "shell":
      return { text: s.busy === null ? "shell, unknown" : s.busy ? "shell, busy" : "shell", cls: "idle" };
    case "unknown":
      return { text: `unknown — ${s.why}`, cls: "unk" };
  }
}

export function page(snap: FleetSnapshot | null, error: string | null, now = Date.now()): string {
  // `startedAt` is an ISO string; Date.parse gives NaN rather than throwing on a
  // bad one, and triageSort sorts NaN last rather than anywhere.
  const rows = triageSort((snap?.rows ?? []).map((r) => ({ ...r, activityAt: Date.parse(r.startedAt) })));
  const counts = triageCounts(rows);
  const body = rows
    .map((r) => {
      const title = r.title ? esc(r.title) : "<i>no title yet</i>";
      const where = [r.repo, r.worktree].filter((x): x is string => x !== null).map(esc).join(" · ");
      const st = statusLabel(r.status);
      return `<li class="${st.cls}"><div class="t">${title}</div><div class="m"><span class="pill">${esc(st.text)}</span>${esc(r.name)}${where ? ` — ${where}` : ""}</div></li>`;
    })
    .join("\n");
  // The unknown count is shown WHENEVER it is non-zero, beside the others. An
  // agents-call failure turns every Claude row unknown at once, and a header
  // reading "0 need you" over eleven unanswerable rows would be exactly the lie
  // the status module exists to prevent.
  const tally = [
    counts.needsYou ? `<b>${counts.needsYou} need you</b>` : "",
    counts.working ? `${counts.working} working` : "",
    counts.other ? `${counts.other} idle` : "",
    counts.unknown ? `<b>${counts.unknown} unknown</b>` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>Fleet</title>
<style>
  :root { color-scheme: light dark; --fg:#111; --dim:#666; --line:#e4e4e4; --bg:#fafafa;
          --pill:#e8e8e8; --pillfg:#444; --needs:#c2410c; --work:#15803d; --unk:#7c3aed; }
  @media (prefers-color-scheme: dark) { :root { --fg:#eee; --dim:#999; --line:#2a2a2a; --bg:#131313;
          --pill:#2a2a2a; --pillfg:#bbb; --needs:#ea580c; --work:#16a34a; --unk:#8b5cf6; } }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:16px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif; }
  header { padding:16px; border-bottom:1px solid var(--line); }
  h1 { margin:0; font-size:17px; font-weight:600; }
  .age { color:var(--dim); font-size:13px; margin-top:3px; }
  ul { list-style:none; margin:0; padding:0; }
  li { padding:12px 16px; border-bottom:1px solid var(--line); }
  .t { font-weight:500; }
  .m { color:var(--dim); font-size:13px; margin-top:4px; word-break:break-word; }
  .empty { padding:24px 16px; color:var(--dim); }
  .pill { display:inline-block; border-radius:99px; padding:1px 8px; margin-right:6px;
          font-size:12px; font-weight:500; background:var(--pill); color:var(--pillfg); }
  li.needs { border-left:3px solid var(--needs); }
  li.needs .pill { background:var(--needs); color:#fff; }
  li.work .pill { background:var(--work); color:#fff; }
  li.unk .pill { background:var(--unk); color:#fff; }
  .tally { margin-top:2px; font-size:13px; }
</style>
</head><body>
<header>
  <h1>${rows.length} session${rows.length === 1 ? "" : "s"}</h1>
  <div class="tally">${tally}</div>
  <div class="age">${ageLine(snap, error, now)}</div>
</header>
${rows.length ? `<ul>\n${body}\n</ul>` : `<div class="empty">Nothing to show.</div>`}
</body></html>`;
}
