/**
 * **The cost analysis as one HTML file** — `npm run cost:analyse -- --html`.
 * docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md
 * § The analysis an agent runs.
 *
 * Self-contained: no script, no request of any kind (no web font, no CDN),
 * inline CSS, light and dark by the system's colour scheme. It opens from disk.
 *
 * ## Its privacy contract — GPT Sol's plan review, F10
 *
 * - **Everything is escaped.** Markup is built with the `html` tag below,
 *   which escapes every interpolated value unless it is itself the result of
 *   `html`. A model name, a slug, an email and the agent's commentary are all
 *   just strings to it. tests/cost-analysis-html.test.ts puts a `<script>` in
 *   each.
 * - **No other owner's slug** can be in it, because none is in the analysis:
 *   the query masks them (src/store/ai-calls-spend-pg.ts).
 * - **Written with mode 0600, atomically** (`writePrivateFile`): a temp file in
 *   the same directory, then a rename. Never uploaded, never served.
 *
 * Pure but for `writePrivateFile`. The per-day chart arrives as a string
 * (scripts/cost-analysis-chart.ts) so this file needs no JSX.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { formatCostNanos } from "../src/admin.js";
import { type Cell, type CostAnalysis, type EvidenceTable, type Lead, P95_MIN_CALLS, type Slice } from "../src/cost-analysis.js";
import {
  FAILURE_DEFINITIONS,
  type FailureGroup,
  NOT_MEASURED,
  OPENROUTER_CREDIT_FEE,
  type Stopped,
  failureSummary,
  nothingMeasured,
  stoppedFigure,
} from "../src/cost-cube.js";

/* --------------------------------------------------------------- escaping -- */

/** Markup that is already safe to place in the page. Only `html` and `trusted` make one. */
export class Safe {
  constructor(readonly html: string) {}
  toString(): string {
    return this.html;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type Piece = Safe | string | number | null | undefined | false | readonly Piece[];

function place(piece: Piece): string {
  if (piece === null || piece === undefined || piece === false) return "";
  if (piece instanceof Safe) return piece.html;
  if (typeof piece === "string") return escapeHtml(piece);
  if (typeof piece === "number") return escapeHtml(String(piece));
  return piece.map(place).join("");
}

/** A template whose every interpolation is escaped, unless it came from `html` itself. */
export function html(strings: TemplateStringsArray, ...values: Piece[]): Safe {
  let out = strings[0] ?? "";
  values.forEach((value, i) => {
    out += place(value) + (strings[i + 1] ?? "");
  });
  return new Safe(out);
}

/**
 * Markup this program made itself and vouches for: the chart React rendered.
 * **Never a database value and never the commentary.**
 */
export function trusted(markup: string): Safe {
  return new Safe(markup);
}

/* ------------------------------------------------------------- commentary -- */

/** `code` and **bold** inside a line that has already been escaped. */
function inline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/**
 * An agent's notes as markup: headings (`#` to `###`), paragraphs, bullet
 * lists, `code` and **bold**. Nothing else is Markdown here; everything else
 * is text.
 *
 * **Escaper first.** The whole input is escaped before a single pattern is
 * looked for, so the only tags that can come out are the ones written in this
 * function. A link, an image or raw HTML in the notes comes out as the
 * characters that were typed.
 */
export function commentaryToHtml(markdown: string): Safe {
  const lines = escapeHtml(markdown.replaceAll("\r\n", "\n")).split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flush = (): void => {
    if (paragraph.length > 0) out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    if (list.length > 0) out.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
    paragraph = [];
    list = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (line === "") flush();
    else if (heading) {
      flush();
      /* One level down: the report's own section heading is the `h2` above these. */
      const level = (heading[1] as string).length + 2;
      out.push(`<h${level}>${inline(heading[2] as string)}</h${level}>`);
    } else if (bullet) {
      if (paragraph.length > 0) flush();
      list.push(bullet[1] as string);
    } else if (list.length > 0) {
      /* A wrapped bullet's second line belongs to the bullet. */
      list[list.length - 1] = `${list[list.length - 1]} ${line}`;
    } else paragraph.push(line);
  }
  flush();
  return new Safe(out.join("\n"));
}

/* -------------------------------------------------------------- formatting -- */

const money = formatCostNanos;
const whole = (n: number): string => n.toLocaleString("en-US");

function percent(share: number | null): string {
  if (share === null) return "—";
  const value = share * 100;
  if (share > 0 && value < 1) return "<1%";
  return `${Math.round(value)}%`;
}

function multiple(times: number | null): string {
  if (times === null) return "—";
  return `${times >= 10 ? Math.round(times) : times.toFixed(1)}×`;
}

export function cellText(cell: Cell): string {
  switch (cell.kind) {
    case "text":
      return cell.text;
    case "money":
      return money(cell.nanos);
    case "count":
      return whole(cell.count);
    case "share":
      return percent(cell.share);
    case "times":
      return multiple(cell.times);
    default:
      return unreachable(cell);
  }
}

function unreachable(value: never): never {
  throw new Error(`unhandled case: ${JSON.stringify(value)}`);
}

/* ----------------------------------------------------------------- pieces -- */

/** A ranking row's bar: its amount against the largest in the table. */
function bar(nanos: number, largest: number): Safe {
  const width = largest > 0 ? Math.max(0, Math.min(100, (nanos / largest) * 100)) : 0;
  return html`<div class="bar" aria-hidden="true"><span style="width:${width.toFixed(1)}%"></span></div>`;
}

function sliceList(slices: readonly Slice[], limit = 3): Safe {
  if (slices.length === 0) return html`—`;
  return html`${slices.slice(0, limit).map(
    (s, i) => html`${i > 0 ? ", " : ""}${s.label} <span class="dim">${money(s.recordedNanos)}</span>`,
  )}`;
}

function sliceTable(title: string, name: string, slices: readonly Slice[]): Safe {
  return html`<table class="nested">
    <caption>${title}</caption>
    <thead><tr><th>${name}</th><th class="n">Recorded</th><th class="n">Share</th><th class="n">Calls</th></tr></thead>
    <tbody>${slices.map(
      (s) =>
        html`<tr><td>${s.label}</td><td class="n">${money(s.recordedNanos)}</td><td class="n">${percent(s.share)}</td><td class="n">${whole(s.calls)}</td></tr>`,
    )}</tbody>
  </table>`;
}

function evidenceTable(table: EvidenceTable): Safe {
  const numeric = (cell: Cell | undefined): boolean => cell !== undefined && cell.kind !== "text";
  return html`<div class="scroll"><table>
    <thead><tr>${table.columns.map((c, i) => html`<th class="${numeric(table.rows[0]?.[i]) ? "n" : ""}">${c}</th>`)}</tr></thead>
    <tbody>${table.rows.map(
      (row) => html`<tr>${row.map((cell) => html`<td class="${numeric(cell) ? "n" : ""}">${cellText(cell)}</td>`)}</tr>`,
    )}</tbody>
  </table></div>
  ${table.omitted > 0 ? html`<p class="dim">And ${whole(table.omitted)} more, in the JSON.</p>` : ""}`;
}

function leadBlock(lead: Lead): Safe {
  return html`<article class="lead" data-lead="${lead.id}">
    <h3>${lead.title}
      <span class="amount">${lead.amountNanos > 0 ? money(lead.amountNanos) : "no amount claimed"}</span>
      <span class="tag ${lead.confidence}">${lead.confidence}</span></h3>
    <p>${lead.detail}</p>
    <dl class="facts">${lead.evidence.facts.map(
      (f) => html`<div><dt>${f.label}</dt><dd>${cellText(f.value)}</dd></div>`,
    )}</dl>
    ${lead.evidence.table ? evidenceTable(lead.evidence.table) : ""}
  </article>`;
}

/* -------------------------------------------------------------- the tokens -- */

/**
 * The page's own tokens, copied by value from styles/tokens.css and
 * styles/colourscales.css, because this file can link to neither. The names
 * are the ones src/web/cost-charts.tsx § `CHART_TOKENS` reads; the test holds
 * that list against both blocks.
 */
export const LIGHT_TOKENS: Readonly<Record<string, string>> = {
  "--background": "oklch(0.985 0 0)",
  "--foreground": "oklch(0.2 0 0)",
  "--muted": "oklch(0.945 0 0)",
  "--muted-foreground": "oklch(0.48 0 0)",
  "--border": "oklch(0.885 0 0)",
  "--cat-0": "rgb(54 151 203)",
  "--cat-1": "rgb(213 94 0)",
  "--cat-2": "rgb(0 158 115)",
  "--cat-3": "rgb(155 145 2)",
  "--cat-4": "rgb(0 114 178)",
  "--cat-5": "rgb(199 116 162)",
  "--cat-6": "rgb(191 131 2)",
  "--cat-7": "rgb(113 113 113)",
};

export const DARK_TOKENS: Readonly<Record<string, string>> = {
  "--background": "oklch(0.145 0 0)",
  "--foreground": "oklch(0.97 0 0)",
  "--muted": "oklch(0.245 0 0)",
  "--muted-foreground": "oklch(0.63 0 0)",
  "--border": "oklch(0.27 0 0)",
  "--cat-0": "rgb(86 180 233)",
  "--cat-1": "rgb(232 112 58)",
  "--cat-2": "rgb(47 191 149)",
  "--cat-3": "rgb(240 228 66)",
  "--cat-4": "rgb(92 143 232)",
  "--cat-5": "rgb(222 143 188)",
  "--cat-6": "rgb(232 163 59)",
  "--cat-7": "rgb(201 201 201)",
};

/**
 * Each token once, as `light-dark(light, dark)`: with `color-scheme: light
 * dark` on the root, the browser picks by the system's scheme. No at-rule, so
 * the file holds no `@` of its own — and "a production report contains no
 * `@`" is a check one `grep` can make (tests/cost-analysis-html.test.ts).
 */
const TOKENS = Object.keys(LIGHT_TOKENS)
  .map((name) => `${name}:light-dark(${LIGHT_TOKENS[name]},${DARK_TOKENS[name]});`)
  .join("");

const STYLE = `
:root{color-scheme:light dark;${TOKENS}}
*{box-sizing:border-box}
body{margin:0;background:var(--background);color:var(--foreground);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:24px;margin:0 0 4px}
h2{font-size:19px;margin:40px 0 8px;padding-top:16px;border-top:1px solid var(--border)}
h3{font-size:16px;margin:20px 0 4px}
h4,h5{font-size:15px;margin:14px 0 4px}
p{margin:6px 0}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--muted);padding:1px 4px;border-radius:3px}
.dim{color:var(--muted-foreground)}
.target{display:inline-block;padding:2px 8px;border-radius:4px;font-weight:600;border:1px solid var(--border)}
.target.production{background:var(--cat-1);color:var(--background);border-color:var(--cat-1)}
dl.meta{display:grid;grid-template-columns:max-content 1fr;gap:2px 16px;margin:12px 0}
dl.meta dt{color:var(--muted-foreground)}
dl.meta dd{margin:0;overflow-wrap:anywhere}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:16px 0}
.tile{border:1px solid var(--border);border-radius:8px;padding:10px 12px}
.tile .label{color:var(--muted-foreground);font-size:13px}
.tile .value{font-size:22px;font-weight:600;font-variant-numeric:tabular-nums}
.tile .note{color:var(--muted-foreground);font-size:12px}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;margin:8px 0;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:5px 10px 5px 0;border-bottom:1px solid var(--border);vertical-align:top}
th{font-weight:600;font-size:13px;color:var(--muted-foreground);vertical-align:bottom}
th.n,td.n{text-align:right}
td.n{white-space:nowrap}
td.name{overflow-wrap:anywhere;min-width:160px}
td.why{padding:0 0 8px;border-bottom:1px solid var(--border)}
tr.has-why>td{border-bottom:none}
table.nested{width:auto;min-width:min(100%,420px);margin:4px 0 8px 12px;font-size:14px}
caption{text-align:left;color:var(--muted-foreground);font-size:13px;padding:4px 0}
.bar{height:6px;border-radius:3px;background:var(--muted);overflow:hidden;min-width:60px;margin-top:8px}
.bar span{display:block;height:100%;border-radius:3px;background:var(--cat-0)}
details summary{cursor:pointer;color:var(--muted-foreground);font-size:13px}
.lead{border:1px solid var(--border);border-radius:8px;padding:4px 14px 10px;margin:12px 0}
.lead .amount{font-variant-numeric:tabular-nums;margin-left:8px}
.tag{font-size:12px;font-weight:500;padding:1px 6px;border-radius:10px;border:1px solid var(--border);color:var(--muted-foreground);margin-left:6px}
dl.facts{display:flex;flex-wrap:wrap;gap:4px 24px;margin:8px 0}
dl.facts div{display:flex;gap:8px}
dl.facts dt{color:var(--muted-foreground)}
dl.facts dd{margin:0;font-variant-numeric:tabular-nums;font-weight:600}
.commentary{border-left:3px solid var(--cat-0);padding:2px 0 2px 14px}
ul{padding-left:20px;margin:6px 0}
`;

/* -------------------------------------------------------------- the report -- */

export interface ReportOptions {
  /** The agent's notes, as typed. Null when there are none. */
  commentary: string | null;
  /** The per-day chart, rendered by scripts/cost-analysis-chart.ts. Null draws the table alone. */
  chart: Safe | null;
  /** The commit of the code that made the report, or null. */
  commit: string | null;
}

function header(a: CostAnalysis, opts: ReportOptions): Safe {
  const production = a.target.kind === "production";
  return html`<h1>Spideryarn cost analysis</h1>
  <p><span class="target ${a.target.kind}" data-target="${a.target.kind}">${production ? "PRODUCTION database, read-only" : "LOCAL database"}</span></p>
  <dl class="meta">
    <dt>Target</dt><dd>${a.target.description}</dd>
    <dt>Period</dt><dd>${a.window.label}${a.totals.firstDay ? html` <span class="dim">· calls from ${a.totals.firstDay} to ${a.totals.lastDay ?? ""}, UTC days</span>` : ""}</dd>
    <dt>Covers</dt><dd>${
      a.scope === "product"
        ? html`Product spend only: readers' requests and pipeline steps. Left out: ${whole(a.excluded.calls)} eval and CLI calls, ${money(a.excluded.recordedNanos)}.`
        : "Everything: product spend, evals and the developer CLI."
    }</dd>
    <dt>Users</dt><dd>${a.userLabels}</dd>
    <dt>Generated</dt><dd>${a.generatedAt}${opts.commit ? html` <span class="dim">· code at ${opts.commit}</span>` : ""}</dd>
  </dl>`;
}

function suggestions(opts: ReportOptions): Safe {
  return html`<h2>Suggestions</h2>
  ${
    opts.commentary !== null && opts.commentary.trim() !== ""
      ? html`<div class="commentary" data-commentary="">${commentaryToHtml(opts.commentary)}</div>`
      : html`<p class="dim" data-commentary="none">This report carries figures and leads only. No suggestions were written into it; an agent adds its own with <code>--commentary</code>.</p>`
  }`;
}

function tile(name: string, label: string, value: string, note: Piece, nanos?: number): Safe {
  return html`<div class="tile" data-tile="${name}"${nanos === undefined ? "" : html` data-nanos="${nanos}"`}>
    <div class="label">${label}</div><div class="value">${value}</div><div class="note">${note}</div>
  </div>`;
}

function tiles(a: CostAnalysis): Safe {
  const t = a.totals;
  return html`<section class="tiles">
    ${tile(
      "recorded",
      "Recorded amount",
      money(t.recordedNanos),
      html`credits ${money(t.creditsNanos)} · provider keys ${money(t.byokNanos)} · priced by us ${money(t.computedNanos)}`,
      t.recordedNanos,
    )}
    ${tile("cash", "Estimated cash", money(t.estimatedCashNanos), `with OpenRouter's ${(OPENROUTER_CREDIT_FEE * 100).toFixed(1)}% fee on the credits`, t.estimatedCashNanos)}
    ${tile("calls", "Calls", whole(t.calls), `${whole(t.pricedCalls)} priced`)}
    ${tile(
      "unpriced",
      "Calls reporting no money",
      whole(t.unpricedCalls),
      a.lookup
        ? html`known shortfall <span data-shortfall-nanos="${a.lookup.knownShortfallNanos}">${money(a.lookup.knownShortfallNanos)}</span>, from ${whole(a.lookup.found)} records OpenRouter holds`
        : t.unpricedCalls > 0
          ? "what they cost was not looked up, so the recorded amount is a floor"
          : "every call was priced",
    )}
    ${tile("failed", "Failed or stopped", whole(t.failedCalls), html`${money(t.failedRecordedNanos)} recorded on them`, t.failedRecordedNanos)}
  </section>`;
}

function users(a: CostAnalysis): Safe {
  const largest = a.users[0]?.recordedNanos ?? 0;
  return html`<h2>Which users are spending the most</h2>
  <div class="scroll"><table data-section="users">
    <thead><tr><th>User</th><th class="n">Recorded</th><th class="n">Share</th><th class="n">Calls</th><th class="n">No money</th><th>Largest modes or tasks</th></tr></thead>
    <tbody>${a.users.map(
      (u) => html`<tr>
        <td class="name">${u.label}${bar(u.recordedNanos, largest)}</td>
        <td class="n">${money(u.recordedNanos)}</td><td class="n">${percent(u.share)}</td>
        <td class="n">${whole(u.calls)}</td><td class="n">${whole(u.unpricedCalls)}</td>
        <td>${sliceList(u.topTasks)}</td>
      </tr>`,
    )}</tbody>
  </table></div>`;
}

function articles(a: CostAnalysis): Safe {
  const largest = a.articles.top[0]?.recordedNanos ?? 0;
  return html`<h2>Why is this article costing so much</h2>
  <p class="dim">The ${whole(a.articles.top.length)} costliest of ${whole(a.articles.count)} articles with any call. The median article recorded ${money(a.articles.medianNanos)}.
    ${whole(a.articles.noArticle.calls)} calls (${money(a.articles.noArticle.recordedNanos)}) belong to no article and are not in this table.</p>
  <div class="scroll"><table data-section="articles">
    <thead><tr><th>Article</th><th>User</th><th class="n">Recorded</th><th class="n">Share</th><th class="n">Against the median</th><th class="n">Jobs</th><th class="n">Calls</th></tr></thead>
    <tbody>${a.articles.top.map(
      (r) => html`<tr class="has-why">
        <td class="name">${r.label}${bar(r.recordedNanos, largest)}</td><td>${r.owner}</td>
        <td class="n">${money(r.recordedNanos)}</td><td class="n">${percent(r.share)}</td>
        <td class="n">${r.timesMedian === null ? "—" : `${multiple(r.timesMedian)} the median article`}</td>
        <td class="n">${whole(r.jobs)}</td><td class="n">${whole(r.calls)}</td>
      </tr>
      <tr><td class="why" colspan="7"><details><summary>Why: by mode or task, and by model</summary>
        ${sliceTable("By mode or task", "Mode or task", r.byTask)}
        ${sliceTable("By answering model", "Model", r.byModel)}
      </details></td></tr>`,
    )}</tbody>
  </table></div>`;
}

function tasks(a: CostAnalysis): Safe {
  const largest = a.tasks[0]?.recordedNanos ?? 0;
  return html`<h2>Why is this mode costing so much</h2>
  <p class="dim">Every mode or task. The three per-call figures are the median, the 95th percentile and the largest single priced call, from the calls themselves. A p95 is shown only from ${P95_MIN_CALLS} priced calls; with fewer it is just the largest call again.</p>
  <div class="scroll"><table data-section="tasks">
    <thead><tr><th>Mode or task</th><th>Category</th><th class="n">Recorded</th><th class="n">Share</th><th class="n">Calls</th><th class="n">Articles</th><th class="n">Median call</th><th class="n">p95</th><th class="n">Largest</th></tr></thead>
    <tbody>${a.tasks.map(
      (t) => html`<tr class="has-why">
        <td class="name">${t.label}${bar(t.recordedNanos, largest)}</td><td>${t.categories.join(", ")}</td>
        <td class="n">${money(t.recordedNanos)}</td><td class="n">${percent(t.share)}</td>
        <td class="n">${whole(t.calls)}${t.unpricedCalls > 0 ? html` <span class="dim">(${whole(t.unpricedCalls)} no money)</span>` : ""}</td>
        <td class="n">${whole(t.articles)}</td>
        <td class="n">${t.perCall ? money(t.perCall.medianNanos) : "—"}</td>
        <td class="n">${t.perCall && t.perCall.calls >= P95_MIN_CALLS ? money(t.perCall.p95Nanos) : "—"}</td>
        <td class="n">${t.perCall ? money(t.perCall.maxNanos) : "—"}</td>
      </tr>
      <tr><td class="why" colspan="9"><details><summary>Why: the models that answered</summary>
        ${sliceTable("By answering model", "Model", t.models)}
      </details></td></tr>`,
    )}</tbody>
  </table></div>`;
}

function models(a: CostAnalysis): Safe {
  const largest = a.models[0]?.recordedNanos ?? 0;
  return html`<h2>By model</h2>
  <p class="dim">The model that answered, which is not always the one asked for.</p>
  <div class="scroll"><table data-section="models">
    <thead><tr><th>Model</th><th class="n">Recorded</th><th class="n">Share</th><th class="n">Calls</th><th>Used by</th></tr></thead>
    <tbody>${a.models.map(
      (m) => html`<tr>
        <td class="name">${m.label}${bar(m.recordedNanos, largest)}</td>
        <td class="n">${money(m.recordedNanos)}</td><td class="n">${percent(m.share)}</td><td class="n">${whole(m.calls)}</td>
        <td>${sliceList(m.tasks, 6)}</td>
      </tr>`,
    )}</tbody>
  </table></div>`;
}

function overTime(a: CostAnalysis, chart: Safe | null): Safe {
  const { days, categories, nanos } = a.overTime;
  const dayTotal = (day: string): number => categories.reduce((n, c) => n + (nanos[day]?.[c] ?? 0), 0);
  return html`<h2>Over time</h2>
  <p class="dim">Recorded amount per UTC day, by category.</p>
  ${
    chart
      ? html`<div class="scroll" data-chart="drawn">${chart}</div>`
      : html`<p class="dim" data-chart="none">The chart could not be drawn; the same figures are in the table.</p>`
  }
  <details ${days.length <= 14 ? "open" : ""}><summary>The same figures as a table (${whole(days.length)} days)</summary>
  <div class="scroll"><table data-section="days">
    <thead><tr><th>UTC day</th>${categories.map((c) => html`<th class="n">${c}</th>`)}<th class="n">All</th></tr></thead>
    <tbody>${days.map(
      (day) => html`<tr><td>${day}</td>${categories.map((c) => {
        const value = nanos[day]?.[c];
        return html`<td class="n">${value === undefined ? "" : money(value)}</td>`;
      })}<td class="n">${money(dayTotal(day))}</td></tr>`,
    )}</tbody>
  </table></div></details>`;
}

function failureCell(value: number | null): Safe {
  return value === null
    ? html`<td class="n dim">${NOT_MEASURED}</td>`
    : html`<td class="n">${whole(value)}</td>`;
}

function stoppedCell(value: Stopped | null): Safe {
  return value === null
    ? html`<td class="n dim">${NOT_MEASURED}</td>`
    : html`<td class="n">${stoppedFigure(value)}</td>`;
}

function failureCounts(section: string, label: string, groups: readonly FailureGroup[]): Safe {
  return html`<div class="scroll"><table data-section="${section}">
    <thead><tr><th>${label}</th><th class="n">Counted attempts</th><th class="n">Retries</th><th class="n">Gave up after the last go</th><th class="n">Died part-way</th><th class="n">Stalled</th><th class="n">Timed out</th><th class="n">Stops not classified</th></tr></thead>
    <tbody>${groups.map(
      (g) =>
        html`<tr><td>${g.label}</td><td class="n">${whole(g.counted)}</td>${failureCell(g.retries)}${failureCell(g.gaveUp)}${failureCell(g.diedPartWay)}${stoppedCell(g.stalled)}${stoppedCell(g.timedOut)}${failureCell(g.stopsNotClassified)}</tr>`,
    )}</tbody>
  </table></div>`;
}

/**
 * The folds `/admin/costs` draws its own section from (src/cost-cube.ts §
 * failures and retries): counts, with the counted attempts beside them and no
 * percentage. A null is written as words, never as a zero.
 */
function failures(a: CostAnalysis): Safe {
  const f = a.failures;
  const anything = !nothingMeasured(f.total);
  return html`<section data-failures>
  <h2>Failures and retries</h2>
  <p data-failures-summary>${failureSummary(f.total)}</p>
  ${
    anything
      ? html`<p class="dim">${FAILURE_DEFINITIONS}</p>
  ${failureCounts("failures-days", "UTC day", f.byDay)}
  ${failureCounts("failures-tasks", "Mode or task", f.byTask)}
  ${
    f.causes.length === 0
      ? html`<p class="dim">No failed attempt here recorded a cause.</p>`
      : html`<div class="scroll"><table data-section="failures-causes">
    <thead><tr><th>Failed</th><th>Cause</th><th>Status</th><th>Upstream</th><th>Model</th><th>Mode or task</th><th class="n">Attempts</th></tr></thead>
    <tbody>${f.causes.map(
      (c) =>
        html`<tr><td>${c.phase}</td><td>${c.failureClass}</td><td>${c.status}</td><td>${c.upstream}</td><td>${c.model}</td><td>${c.task}</td><td class="n">${whole(c.attempts)}</td></tr>`,
    )}</tbody>
  </table></div>`
  }`
      : ""
  }
  <ul class="dim">${f.notes.map((note) => html`<li>${note}</li>`)}</ul>
  </section>`;
}

function cacheUse(a: CostAnalysis): Safe {
  if (a.cacheUse.length === 0) return html``;
  return html`<details><summary>Cache use by mode or task, one wire at a time</summary>
  <p class="dim">The share of a task's prompt tokens that were read from cache. Each row is one wire: the two wires count input tokens differently, so their shares are never added or averaged together. Calls per job is the median number of the task's calls in one job (one run, for request work): reuse inside a job needs several, so only those are flagged.</p>
  <div class="scroll"><table data-section="cache">
    <thead><tr><th>Mode or task</th><th>Wire</th><th class="n">Calls</th><th class="n">Calls per job (median)</th><th class="n">Articles</th><th class="n">Recorded</th><th class="n">Read from cache</th></tr></thead>
    <tbody>${a.cacheUse.map(
      (c) => html`<tr><td>${c.task}</td><td>${c.wire}</td><td class="n">${whole(c.calls)}</td><td class="n">${whole(c.medianCallsPerJob)}</td><td class="n">${whole(c.articles)}</td>
        <td class="n">${money(c.recordedNanos)}</td><td class="n">${percent(c.cacheReadShare)}${c.flagged ? " (flagged)" : ""}</td></tr>`,
    )}</tbody>
  </table></div></details>`;
}

function leads(a: CostAnalysis): Safe {
  return html`<h2>Leads</h2>
  <p class="dim">Shapes in the ledger worth a look, most money first. Each says what was measured and what it does not show. None is a verdict.</p>
  ${a.leads.length === 0 ? html`<p>None: there are no calls in this period.</p>` : a.leads.map(leadBlock)}
  ${cacheUse(a)}`;
}

function howToRead(a: CostAnalysis): Safe {
  return html`<h2>How to read this</h2>
  <ul>
    <li><strong>Recorded amount</strong> is what the ledger holds: OpenRouter credits, plus calls billed to a provider's own key, plus calls we price ourselves from a price table. <strong>Estimated cash</strong> adds OpenRouter's fee for buying the credits, and only to the credits.</li>
    <li><strong>It is a floor</strong> when any call reports no money (${whole(a.totals.unpricedCalls)} here). A call that wrote no ledger row at all is in no figure on this page.</li>
    <li><strong>Every date is UTC</strong>, and a period's end is not included.</li>
    <li><strong>Other readers' articles are opaque ids by design.</strong> Only the administrator's own articles are named; another reader's is <code>article 3f9a2c1e</code>, or <code>recorded article …</code> when the ledger kept a name and no id. No article text, prompt or answer is in the ledger or in this file.</li>
    <li><strong>A task's p95 is shown only from ${P95_MIN_CALLS} priced calls.</strong> With fewer, the 95th percentile is the largest call over again, so the cell holds a dash; the number is still in the JSON, beside how many calls it rests on.</li>
    <li><strong>A user's share, an article's and a task's</strong> are all of the recorded amount in the period this report covers.</li>
    <li><strong>This file is private</strong>: it is written readable by its owner only, and is not uploaded or served anywhere.</li>
    <li>The definitions live in <code>src/cost-cube.ts</code> (the money and the grouping), <code>src/cost-analysis.ts</code> (the leads and their thresholds), <code>src/cost-categories.ts</code> (the categories) and <code>docs/project/cost-tracking.md</code>. The same figures, live, are on <code>/admin/costs</code>.</li>
  </ul>`;
}

/** The whole report, as one self-contained document. */
export function renderCostReport(analysis: CostAnalysis, opts: ReportOptions): string {
  const title = `Cost analysis · ${analysis.target.kind} · ${analysis.window.label}`;
  const page = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>${trusted(STYLE)}</style>
</head>
<body>
<main>
${header(analysis, opts)}
${suggestions(opts)}
${tiles(analysis)}
${users(analysis)}
${articles(analysis)}
${tasks(analysis)}
${models(analysis)}
${overTime(analysis, opts.chart)}
${failures(analysis)}
${leads(analysis)}
${howToRead(analysis)}
</main>
</body>
</html>
`;
  return page.html;
}

/* ---------------------------------------------------------------- the file -- */

/**
 * Write `text` to `file` so that nobody else on the machine can read it and no
 * reader ever sees half of it: a temp file in the same directory, created
 * `0600` and exclusively, then renamed over the target.
 *
 * Returns the absolute path, which the caller prints.
 */
export function writePrivateFile(file: string, text: string): string {
  const target = path.resolve(file);
  const dir = path.dirname(target);
  mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(target)}.${randomBytes(6).toString("hex")}.tmp`);
  /* `wx`: fail rather than write through a file or a link somebody left there. */
  const fd = openSync(temp, "wx", 0o600);
  try {
    /* `writeFileSync` owns the full-write loop. One `writeSync` may legally
       write only a prefix, which would still be renamed as a complete report. */
    writeFileSync(fd, text);
  } catch (err) {
    closeSync(fd);
    rmSync(temp, { force: true });
    throw err;
  }
  closeSync(fd);
  /* The mode given to `open` is cut by the umask, which can only remove bits.
     Said again for a umask stranger than that. */
  chmodSync(temp, 0o600);
  renameSync(temp, target);
  return target;
}
