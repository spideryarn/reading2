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
import type { FleetSnapshot } from "./collect.js";

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

export function page(snap: FleetSnapshot | null, error: string | null, now = Date.now()): string {
  const rows = snap?.rows ?? [];
  const body = rows
    .map((r) => {
      const title = r.title ? esc(r.title) : "<i>no title yet</i>";
      const where = [r.repo, r.worktree].filter((x): x is string => x !== null).map(esc).join(" · ");
      return `<li><div class="t">${title}</div><div class="m">${esc(r.name)}${where ? ` — ${where}` : ""}</div></li>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>Fleet</title>
<style>
  :root { color-scheme: light dark; --fg:#111; --dim:#666; --line:#e4e4e4; --bg:#fafafa; }
  @media (prefers-color-scheme: dark) { :root { --fg:#eee; --dim:#999; --line:#2a2a2a; --bg:#131313; } }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:16px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif; }
  header { padding:16px; border-bottom:1px solid var(--line); }
  h1 { margin:0; font-size:17px; font-weight:600; }
  .age { color:var(--dim); font-size:13px; margin-top:3px; }
  ul { list-style:none; margin:0; padding:0; }
  li { padding:12px 16px; border-bottom:1px solid var(--line); }
  .t { font-weight:500; }
  .m { color:var(--dim); font-size:13px; margin-top:2px; word-break:break-word; }
  .empty { padding:24px 16px; color:var(--dim); }
</style>
</head><body>
<header>
  <h1>${rows.length} session${rows.length === 1 ? "" : "s"}</h1>
  <div class="age">${ageLine(snap, error, now)}</div>
</header>
${rows.length ? `<ul>\n${body}\n</ul>` : `<div class="empty">Nothing to show.</div>`}
</body></html>`;
}
