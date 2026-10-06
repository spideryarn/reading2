// @vitest-environment jsdom
/**
 * The cost analysis's HTML report —
 * [scripts/cost-analysis-html.ts](../scripts/cost-analysis-html.ts) and the
 * chart it embeds, [scripts/cost-analysis-chart.ts](../scripts/cost-analysis-chart.ts).
 * docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md
 * § What GPT Sol's plan review changed, F10: the report file's privacy contract.
 *
 * Each clause of that contract is a test here: everything escaped, no other
 * owner's slug anywhere, no script and no request, mode 0600, written
 * atomically. jsdom only to read the markup back as elements.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  type ChartModule,
  CATEGORY_COLOUR_ORDER,
  dayChartMarkup,
  daySeriesOf,
} from "../scripts/cost-analysis-chart.js";
import {
  DARK_TOKENS,
  LIGHT_TOKENS,
  commentaryToHtml,
  escapeHtml,
  html,
  renderCostReport,
  trusted,
  writePrivateFile,
} from "../scripts/cost-analysis-html.js";
import { PRODUCTION_USERS_NOTE } from "../scripts/cost-analysis.js";
import { type CostAnalysisInput, P95_MIN_CALLS, analyseCosts } from "../src/cost-analysis.js";
import { type CostCubeGroup, failureSummary } from "../src/cost-cube.js";
import type { SpendDetailRow } from "../src/store/ai-calls-spend-pg.js";
import { formatCostNanos } from "../src/web/admin-costs-view.js";
import * as charts from "../src/web/cost-charts.js";

/* The chart script loads this module by a path the node project's compiler
   does not follow. This assignment is where its real type is checked against
   the shape that script expects (`npm run typecheck` covers tests/). */
const typedCharts: ChartModule = charts;

const ME = "c057b11a-0000-4000-8000-000000000001";
const THEM = "c057b11b-0000-4000-8000-000000000002";
const CENT = 10_000_000;

/** A slug of somebody else's: the query never returns it, so it may be nowhere in the file. */
const THEIR_SLUG = "their-private-reading-about-a-diagnosis";
const ATTACK = '<script>alert("x")</script>';
const IMG = "<img src=x onerror=alert(1)>";

let next = 0;
function call(over: Partial<SpendDetailRow> = {}): SpendDetailRow {
  next++;
  return {
    id: `call-${next}`,
    runId: `run-${next}`,
    jobId: `job-${next}`,
    generationId: `gen-${next}`,
    startedAt: "2031-03-10T10:00:00.000Z",
    ownerId: ME,
    articleId: "c057b11c-0000-4000-8000-000000000001",
    articleSlug: "my-own-article",
    recordedSlugHash: null,
    scopeKind: "job_step",
    job: "glossary",
    stepName: "glossary",
    wire: "messages",
    requestedModel: "anthropic/claude-sonnet-5",
    answeredModel: "anthropic/claude-sonnet-5",
    upstream: "Anthropic",
    providerAccount: "openrouter",
    costSource: "provider",
    isByok: false,
    outcome: "ok",
    attempt: null,
    failurePhase: null,
    failureClass: null,
    failureStatus: null,
    eventKind: null,
    creditsUsedNanos: CENT,
    byokUpstreamNanos: null,
    computedCostNanos: null,
    reportedInputTokens: 1000,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    webSearches: null,
    durationMs: 1000,
    ...over,
  };
}

/** One group per call: the cube `spendCube` would return, ungrouped, which adds up the same. */
function cubeOf(detail: readonly SpendDetailRow[]): CostCubeGroup[] {
  return detail.map((r) => {
    const missing = r.isByok === true ? r.byokUpstreamNanos === null : r.creditsUsedNanos === null;
    return {
      day: r.startedAt.slice(0, 10),
      ownerId: r.ownerId,
      articleId: r.articleId,
      articleSlug: r.articleSlug,
      recordedSlugHash: r.recordedSlugHash,
      scopeKind: r.scopeKind,
      job: r.job,
      stepName: r.stepName,
      wire: r.wire,
      requestedModel: r.requestedModel,
      answeredModel: r.answeredModel,
      upstream: r.upstream,
      providerAccount: r.providerAccount,
      costSource: r.costSource,
      isByok: r.isByok,
      outcome: r.outcome,
      failurePhase: r.failurePhase,
      failureClass: r.failureClass,
      failureStatus: r.failureStatus,
      counted: r.attempt === null ? 0 : 1,
      retries: r.attempt !== null && r.attempt > 1 ? 1 : 0,
      gaveUp: r.outcome === "error" && r.failurePhase === "before_answer" && r.attempt === 3 ? 1 : 0,
      calls: 1,
      creditsNanos: r.creditsUsedNanos ?? 0,
      byokNanos: r.byokUpstreamNanos ?? 0,
      computedNanos: r.computedCostNanos ?? 0,
      unpricedCalls: r.costSource !== "computed" && missing ? 1 : 0,
      computedCalls: r.costSource === "computed" ? 1 : 0,
      settledCalls: r.costSource === "provider" ? 1 : 0,
    };
  });
}

/**
 * A ledger with a hostile string in every free-text column the report shows,
 * and enough shape to fire every section and most leads.
 */
const DETAIL: SpendDetailRow[] = [
  /* A second go that answered; the 12th, below, is a day nothing numbered. */
  call({ creditsUsedNanos: 123 * CENT, jobId: "job-A", attempt: 2 }),
  call({ creditsUsedNanos: 40 * CENT, jobId: "job-B", startedAt: "2031-03-12T10:00:00.000Z" }),
  call({ creditsUsedNanos: 0, byokUpstreamNanos: 30 * CENT, isByok: true }),
  call({ costSource: "computed", creditsUsedNanos: null, computedCostNanos: 20 * CENT, scopeKind: "request", job: "live_conversation", stepName: null, wire: "realtime" }),
  call({ id: "unpriced-call", costSource: "none", creditsUsedNanos: null, outcome: "aborted" }),
  /* The last go, refused: a call that gave up. Its class is hostile, as if the closed list had failed. */
  call({
    outcome: "error",
    creditsUsedNanos: 5 * CENT,
    attempt: 3,
    failurePhase: "before_answer",
    failureClass: `refused ${IMG}`,
    failureStatus: 503,
  }),
  /* Hostile values, as an attacker who could write a model name, a job or a slug would. */
  call({ answeredModel: `evil/${ATTACK}`, creditsUsedNanos: 7 * CENT }),
  call({ job: IMG, stepName: null, scopeKind: "request", creditsUsedNanos: 6 * CENT }),
  call({ articleId: "c3c3c3c3-0000-4000-8000-000000000003", articleSlug: `slug-${ATTACK}`, creditsUsedNanos: 3 * CENT }),
  /* Somebody else's article: an opaque id, as the query returns it. */
  call({ ownerId: THEM, articleId: "3f9a2c1e-0000-4000-8000-00000000000b", articleSlug: null, creditsUsedNanos: 9 * CENT }),
];

function input(over: Partial<CostAnalysisInput> = {}): CostAnalysisInput {
  return {
    target: { kind: "production", description: `/somewhere/.env.prod → host.example:6543 ${ATTACK}` },
    window: { since: null, until: null, label: `all recorded calls ${IMG}` },
    generatedAt: "2031-04-01T00:00:00.000Z",
    cube: cubeOf(DETAIL),
    detail: DETAIL,
    emails: new Map([[ME, `me${ATTACK}@example.test`]]),
    userLabels: `emails from a fixture ${ATTACK}`,
    includeNonProduct: false,
    top: 15,
    lookups: new Map([["unpriced-call", { kind: "found", creditsNanos: 44 * CENT, upstreamNanos: 0 }]]),
    ...over,
  };
}

const ANALYSIS = analyseCosts(input());
const REACT_GLOBAL_BEFORE = Object.getOwnPropertyDescriptor(globalThis, "React");
const chart = await dayChartMarkup(ANALYSIS);
const REPORT = renderCostReport(ANALYSIS, {
  commentary: `# Findings ${ATTACK}\n\nSpend on **labels** is high. ${IMG}\n\n- try \`--top 3\`\n- [a link](https://example.test/x)`,
  chart: trusted(chart.markup),
  commit: "abc123def",
});

function parse(markup: string): Document {
  return new DOMParser().parseFromString(markup, "text/html");
}

const DOC = parse(REPORT);

describe("the html tag", () => {
  it("escapes every interpolated string, and passes its own results through", () => {
    const inner = html`<b>${"<i>"}</b>`;
    expect(html`<p title="${'"><script>'}">${inner}${[html`<br>`, "a&b"]}${7}${null}${false}</p>`.html).toBe(
      '<p title="&quot;&gt;&lt;script&gt;"><b>&lt;i&gt;</b><br>a&amp;b7</p>',
    );
  });

  it("escapes the five characters that matter", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });
});

describe("the commentary converter", () => {
  it("renders headings, paragraphs, bullets, code and bold, one heading level down", () => {
    const out = commentaryToHtml(
      "# Top\n\nA paragraph\nover two lines.\n\n## Second\n- one **bold**\n- two `code`\n  wrapped\n\n### Third\nlast",
    ).html;
    expect(out).toBe(
      [
        "<h3>Top</h3>",
        "<p>A paragraph over two lines.</p>",
        "<h4>Second</h4>",
        "<ul><li>one <strong>bold</strong></li><li>two <code>code</code> wrapped</li></ul>",
        "<h5>Third</h5>",
        "<p>last</p>",
      ].join("\n"),
    );
  });

  it("escapes first, so no tag but its own can come out", () => {
    const out = commentaryToHtml(`${ATTACK}\n\n- ${IMG}\n\n# <b>x</b>\n\n\`<i>\` **<u>**`).html;
    expect(out).not.toMatch(/<script|<img|<b>|<i>|<u>/);
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("<code>&lt;i&gt;</code>");
    expect(out).toContain("<strong>&lt;u&gt;</strong>");
    const tags = [...out.matchAll(/<\/?([a-z0-9]+)/g)].map((m) => m[1]);
    expect(new Set(tags)).toEqual(new Set(["p", "ul", "li", "h3", "code", "strong"]));
  });

  it("does not make a link or an image out of Markdown it does not know", () => {
    const out = commentaryToHtml("[x](javascript:alert(1)) ![y](http://example.test/p.png)").html;
    expect(out).not.toMatch(/<a |<img/);
    expect(out).toContain("[x](javascript:alert(1))");
  });
});

describe("the report: nothing a database value or the commentary says can run", () => {
  it("has no script element, no event-handler attribute and no image", () => {
    expect(DOC.querySelectorAll("script")).toHaveLength(0);
    expect(DOC.querySelectorAll("img, iframe, object, embed, link, base, form")).toHaveLength(0);
    for (const element of DOC.querySelectorAll("*")) {
      for (const attribute of element.attributes) {
        expect(attribute.name, element.tagName).not.toMatch(/^on/i);
      }
    }
  });

  it("shows each hostile value as the text that was written", () => {
    const text = DOC.body.textContent ?? "";
    /* The model, the job, the slug, the email, the target, the window and the commentary. */
    expect(text).toContain(`evil/${ATTACK}`);
    expect(text).toContain(IMG);
    expect(text).toContain(`slug-${ATTACK}`);
    expect(text).toContain(`me${ATTACK}@example.test`);
    expect(text).toContain(`host.example:6543 ${ATTACK}`);
    expect(text).toContain(`Findings ${ATTACK}`);
    expect(DOC.title).toContain(IMG);
  });

  it("never carries the raw markup of one, anywhere in the file", () => {
    expect(REPORT).not.toContain("<script");
    expect(REPORT).not.toContain("<img");
    expect(REPORT.match(/&lt;script&gt;/g)?.length).toBeGreaterThan(5);
  });

  it("renders the commentary under Suggestions, and says so when there is none", () => {
    const commentary = DOC.querySelector("[data-commentary]");
    expect(commentary?.querySelector("h3")?.textContent).toContain("Findings");
    expect(commentary?.querySelector("strong")?.textContent).toBe("labels");
    expect(commentary?.querySelectorAll("li")).toHaveLength(2);
    expect(commentary?.querySelector("a")).toBeNull();
    const bare = parse(renderCostReport(ANALYSIS, { commentary: null, chart: null, commit: null }));
    expect(bare.querySelector('[data-commentary="none"]')?.textContent).toMatch(/figures and leads only/);
    expect(bare.querySelector('[data-chart="none"]')).not.toBeNull();
  });
});

describe("the report: no other owner's slug", () => {
  it("names the asker's own article and shows anybody else's as an opaque id", () => {
    expect(REPORT).toContain("my-own-article");
    expect(REPORT).toContain("article 3f9a2c1e");
    expect(REPORT).toContain("user c057b11b");
  });

  it("has nowhere a slug could arrive from but the masked rows", () => {
    /* The rows above are what `spendDetail` returns for somebody else's article:
       no slug. The control: put one in, and it shows — so its absence above is
       the query's doing and this search can see a slug when there is one. */
    expect(REPORT).not.toContain(THEIR_SLUG);
    const leaked = DETAIL.map((r) => (r.ownerId === THEM ? { ...r, articleSlug: THEIR_SLUG } : r));
    const leaking = renderCostReport(analyseCosts(input({ detail: leaked, cube: cubeOf(leaked) })), {
      commentary: null,
      chart: null,
      commit: null,
    });
    expect(leaking).toContain(THEIR_SLUG);
  });
});

describe("the report: self-contained", () => {
  it("does not install React on the process global to load the shared chart", () => {
    expect(Object.getOwnPropertyDescriptor(globalThis, "React")).toEqual(REACT_GLOBAL_BEFORE);
  });

  it("makes no request: no attribute that loads anything, no import, no font", () => {
    /* A URL somebody typed into the commentary is text and stays text; what
       must not exist is an element or a rule that would fetch one. */
    for (const element of DOC.querySelectorAll("*")) {
      for (const attribute of element.attributes) {
        expect(attribute.name, element.tagName).not.toMatch(/^(href|src|srcset|action|poster|data|background|xlink:href)$/i);
      }
    }
    expect(DOC.querySelectorAll("style")).toHaveLength(1);
    expect(DOC.querySelector("style")?.textContent).not.toMatch(/@import|url\(|@font-face/);
    expect(REPORT).not.toMatch(/style="[^"]*url\(/);
  });

  it("is readable on a phone and follows the system's colour scheme", () => {
    expect(DOC.querySelector('meta[name="viewport"]')?.getAttribute("content")).toContain("width=device-width");
    expect(DOC.querySelector('meta[name="color-scheme"]')?.getAttribute("content")).toBe("light dark");
    expect(DOC.querySelector("style")?.textContent).toContain(":root{color-scheme:light dark;");
  });

  it("holds no @ at all when it is a production report: users are ids, and the header says so", () => {
    /* The fixture above gives an email, as a local report has. A production
       run is given none (scripts/cost-analysis.ts § `readEmails`). */
    const production = renderCostReport(
      analyseCosts(input({ emails: new Map(), userLabels: PRODUCTION_USERS_NOTE })),
      { commentary: null, chart: trusted(chart.markup), commit: "abc123def" },
    );
    expect(production).not.toContain("@");
    expect(production).toContain("user c057b11a");
    expect(production).toContain("users are shown by id: production email addresses are not read from the box");
    /* The control: the same search sees an address when there is one. */
    expect(REPORT).toContain("@example.test");
  });

  it("defines every token the chart reads, for both schemes", () => {
    expect(typedCharts.CHART_TOKENS.length).toBeGreaterThan(0);
    expect(chart.tokens).toEqual(typedCharts.CHART_TOKENS);
    const style = DOC.querySelector("style")?.textContent ?? "";
    for (const token of typedCharts.CHART_TOKENS) {
      expect(Object.keys(LIGHT_TOKENS), token).toContain(token);
      expect(Object.keys(DARK_TOKENS), token).toContain(token);
      expect(style, token).toContain(`${token}:light-dark(${LIGHT_TOKENS[token]},${DARK_TOKENS[token]});`);
    }
    /* And the chart's markup reads nothing the list does not name. */
    for (const [, used] of chart.markup.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
      expect(typedCharts.CHART_TOKENS, used).toContain(used);
    }
  });

  it("draws the page's own chart, one bar group per day, with the figures as a table beside it", () => {
    const drawn = DOC.querySelector('[data-chart="drawn"] svg');
    expect(drawn?.getAttribute("role")).toBe("img");
    expect(DOC.querySelectorAll('[data-chart="drawn"] [data-day]')).toHaveLength(ANALYSIS.overTime.days.length);
    expect(DOC.querySelectorAll('[data-section="days"] tbody tr')).toHaveLength(ANALYSIS.overTime.days.length);
    expect(daySeriesOf(ANALYSIS).values.get("2031-03-12")?.get("on-demand enrichment")).toBe(40 * CENT);
    expect(CATEGORY_COLOUR_ORDER).toEqual([...CATEGORY_COLOUR_ORDER].sort());
  });
});

describe("the report: its figures are the analysis's", () => {
  const tile = (name: string) => DOC.querySelector(`[data-tile="${name}"]`);
  const value = (name: string) => tile(name)?.querySelector(".value")?.textContent;

  it("says which database, first, and the period and the commit", () => {
    expect(DOC.querySelector("[data-target]")?.getAttribute("data-target")).toBe("production");
    expect(DOC.querySelector("[data-target]")?.textContent).toMatch(/PRODUCTION database, read-only/);
    expect(DOC.querySelector("dl.meta")?.textContent).toContain("abc123def");
    expect(DOC.querySelector("dl.meta")?.textContent).toContain("2031-04-01T00:00:00.000Z");
    const local = parse(
      renderCostReport(analyseCosts(input({ target: { kind: "local", description: "a laptop" } })), {
        commentary: null,
        chart: null,
        commit: null,
      }),
    );
    expect(local.querySelector("[data-target]")?.textContent).toMatch(/LOCAL database/);
  });

  it("shows every headline amount exactly as the analysis has it", () => {
    const t = ANALYSIS.totals;
    expect(t.recordedNanos).toBe(243 * CENT);
    expect(value("recorded")).toBe(formatCostNanos(t.recordedNanos));
    expect(tile("recorded")?.getAttribute("data-nanos")).toBe(String(t.recordedNanos));
    expect(tile("recorded")?.querySelector(".note")?.textContent).toBe(
      `credits ${formatCostNanos(t.creditsNanos)} · provider keys ${formatCostNanos(t.byokNanos)} · priced by us ${formatCostNanos(t.computedNanos)}`,
    );
    expect(value("cash")).toBe(formatCostNanos(t.estimatedCashNanos));
    expect(tile("cash")?.getAttribute("data-nanos")).toBe(String(t.estimatedCashNanos));
    expect(value("calls")).toBe(String(t.calls));
    expect(value("unpriced")).toBe(String(t.unpricedCalls));
    expect(value("failed")).toBe(String(t.failedCalls));
    expect(tile("failed")?.getAttribute("data-nanos")).toBe(String(t.failedRecordedNanos));
    expect(tile("failed")?.querySelector(".note")?.textContent).toContain(formatCostNanos(t.failedRecordedNanos));
  });

  it("shows the known shortfall only when the unpriced calls were looked up", () => {
    expect(ANALYSIS.lookup?.knownShortfallNanos).toBe(44 * CENT);
    expect(tile("unpriced")?.querySelector("[data-shortfall-nanos]")?.getAttribute("data-shortfall-nanos")).toBe(
      String(44 * CENT),
    );
    expect(tile("unpriced")?.textContent).toContain(formatCostNanos(44 * CENT));
    const unasked = parse(
      renderCostReport(analyseCosts(input({ lookups: null })), { commentary: null, chart: null, commit: null }),
    );
    expect(unasked.querySelector("[data-shortfall-nanos]")).toBeNull();
    expect(unasked.querySelector('[data-tile="unpriced"]')?.textContent).toMatch(/not looked up/);
  });

  it("has a ranking for each question, a bar on each row, and a why under articles and tasks", () => {
    for (const [section, rows] of [
      ["users", ANALYSIS.users.length],
      ["models", ANALYSIS.models.length],
    ] as const) {
      const body = DOC.querySelectorAll(`[data-section="${section}"] > tbody > tr`);
      expect(body, section).toHaveLength(rows);
      expect(DOC.querySelectorAll(`[data-section="${section}"] .bar`), section).toHaveLength(rows);
    }
    for (const [section, rows] of [
      ["articles", ANALYSIS.articles.top.length],
      ["tasks", ANALYSIS.tasks.length],
    ] as const) {
      expect(DOC.querySelectorAll(`[data-section="${section}"] .bar`), section).toHaveLength(rows);
      expect(DOC.querySelectorAll(`[data-section="${section}"] details`), section).toHaveLength(rows);
    }
    const first = DOC.querySelector('[data-section="users"] .bar span') as HTMLElement | null;
    expect(first?.getAttribute("style")).toBe("width:100.0%");
    const mine = DOC.querySelector('[data-section="articles"] > tbody > tr');
    expect(mine?.textContent).toContain("my-own-article");
    expect(mine?.textContent).toMatch(/× the median article/);
  });

  it("lists every lead with its amount and the sentence of what it does not show", () => {
    const blocks = [...DOC.querySelectorAll("[data-lead]")];
    expect(blocks.map((b) => b.getAttribute("data-lead"))).toEqual(ANALYSIS.leads.map((l) => l.id));
    expect(blocks.length).toBeGreaterThan(3);
    for (const [i, block] of blocks.entries()) {
      const lead = ANALYSIS.leads[i];
      expect(block.textContent, lead?.id).toMatch(/does not show/);
      if (lead && lead.amountNanos > 0) expect(block.querySelector(".amount")?.textContent).toBe(formatCostNanos(lead.amountNanos));
    }
  });

  it("withholds a p95 that rests on fewer than twenty priced calls, and shows one that does not", () => {
    const task = (label: string, calls: number) => ({
      ...(ANALYSIS.tasks[0] as (typeof ANALYSIS.tasks)[number]),
      key: label,
      label,
      perCall: { medianNanos: 2 * CENT, p95Nanos: 77 * CENT, maxNanos: 88 * CENT, calls },
    });
    const doc = parse(
      renderCostReport(
        { ...ANALYSIS, tasks: [task("few-calls", P95_MIN_CALLS - 1), task("enough-calls", P95_MIN_CALLS)] },
        { commentary: null, chart: null, commit: null },
      ),
    );
    const cells = (label: string) =>
      [...doc.querySelectorAll('[data-section="tasks"] > tbody > tr.has-why')]
        .find((row) => row.textContent?.includes(label))
        ?.querySelectorAll("td");
    /* Median, p95, largest are the last three cells. */
    expect([...(cells("few-calls") ?? [])].slice(-3).map((c) => c.textContent)).toEqual(["$0.02", "—", "$0.88"]);
    expect([...(cells("enough-calls") ?? [])].slice(-3).map((c) => c.textContent)).toEqual(["$0.02", "$0.77", "$0.88"]);
    expect(doc.body.textContent).toMatch(/p95 is shown only from 20 priced calls/);
  });

  it("shows calls per job for every pair in the cache table, flagged or not", () => {
    const use = (task: string, medianCallsPerJob: number, flagged: boolean) => ({
      task,
      wire: "messages",
      calls: 40,
      medianCallsPerJob,
      articles: 5,
      recordedNanos: 300 * CENT,
      cacheReadShare: 0.02,
      flagged,
    });
    const doc = parse(
      renderCostReport(
        { ...ANALYSIS, cacheUse: [use("several-per-job", 4, true), use("one-per-job", 1, false)] },
        { commentary: null, chart: null, commit: null },
      ),
    );
    const headers = [...doc.querySelectorAll('[data-section="cache"] th')].map((th) => th.textContent);
    expect(headers).toContain("Calls per job (median)");
    const rows = [...doc.querySelectorAll('[data-section="cache"] tbody tr')].map((row) =>
      [...row.querySelectorAll("td")].map((td) => td.textContent?.trim()),
    );
    expect(rows).toEqual([
      ["several-per-job", "messages", "40", "4", "5", "$3.00", "2% (flagged)"],
      ["one-per-job", "messages", "40", "1", "5", "$3.00", "2%"],
    ]);
  });

  it("explains how to read it", () => {
    const text = DOC.body.textContent ?? "";
    expect(text).toMatch(/Estimated cash adds OpenRouter's fee/);
    expect(text).toMatch(/It is a floor/);
    expect(text).toMatch(/Every date is UTC/);
    expect(text).toMatch(/opaque ids by design/);
    expect(text).toMatch(/src\/cost-cube\.ts/);
  });
});

describe("the report: failures and retries", () => {
  it("shows zero deaths beside unmeasured retries on an unnumbered phase-recorded failure", () => {
    const detail = [call({ attempt: null, outcome: "error", failurePhase: "before_answer", failureClass: "refused", failureStatus: 503 })];
    const report = parse(renderCostReport(analyseCosts(input({ cube: cubeOf(detail), detail, lookups: null })), {
      commentary: null, chart: null, commit: null,
    }));
    for (const table of ["failures-days", "failures-tasks"]) {
      const cells = [...report.querySelectorAll(`[data-section="${table}"] tbody tr td`)].map((td) => td.textContent);
      expect(cells.slice(1)).toEqual(["0", "not measured", "not measured", "0"]);
    }
    expect(report.querySelector("[data-failures-summary]")?.textContent).toContain("0 attempts died part-way.");
  });

  const doc = parse(REPORT);
  const cells = (name: string) =>
    [...doc.querySelectorAll(`table[data-section="${name}"] tbody tr`)].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => td.textContent ?? ""),
    );

  it("has the section, with the totals in the analysis's own sentence", () => {
    expect([...doc.querySelectorAll("h2")].map((h) => h.textContent)).toContain("Failures and retries");
    expect(ANALYSIS.failures.total).toMatchObject({ counted: 2, retries: 2, gaveUp: 1, diedPartWay: 0 });
    expect(doc.querySelector("[data-failures-summary]")?.textContent).toBe(failureSummary(ANALYSIS.failures.total));
  });

  it("counts per UTC day and per task, and writes not measured where nothing was counted", () => {
    expect(cells("failures-days")).toEqual([
      ["2031-03-10", "2", "2", "1", "0"],
      ["2031-03-12", "0", "not measured", "not measured", "not measured"],
    ]);
    const glossary = cells("failures-tasks").find((row) => row[0] === "glossary");
    expect(glossary).toEqual(["glossary", "2", "2", "1", "0"]);
  });

  it("lists the causes, and shows a hostile class as the text that was written", () => {
    expect(cells("failures-causes")).toEqual([
      ["before the answer began", `refused ${IMG}`, "503", "Anthropic", "anthropic/claude-sonnet-5", "glossary", "1"],
    ]);
  });

  it("says what the counts are not, and draws no percentage", () => {
    const section = doc.querySelector("[data-failures]")?.textContent ?? "";
    for (const note of ANALYSIS.failures.notes) expect(section).toContain(note);
    expect(section).toContain("Stalls are not measured.");
    expect(section).not.toContain("%");
  });

  it("says not measured, with no table, when nothing in the ledger was counted", () => {
    const plain = [call(), call()];
    const report = parse(
      renderCostReport(analyseCosts(input({ cube: cubeOf(plain), detail: plain, lookups: null })), {
        commentary: null,
        chart: null,
        commit: null,
      }),
    );
    expect(report.querySelector("[data-failures-summary]")?.textContent).toBe(
      "Not measured: none of the 2 attempts was numbered by our retry loop.",
    );
    expect(report.querySelector("[data-failures] table")).toBeNull();
  });
});

describe("the report file", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "spya-cost-report-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("is created readable by its owner only, and its absolute path is returned", () => {
    const written = writePrivateFile(path.join(dir, "nested", "report.html"), REPORT);
    expect(path.isAbsolute(written)).toBe(true);
    expect(statSync(written).mode & 0o777).toBe(0o600);
    expect(readFileSync(written, "utf8")).toBe(REPORT);
  });

  it("replaces a file that was there, with the private mode and no temp file left behind", () => {
    const file = path.join(dir, "again.html");
    writeFileSync(file, "old and world-readable", { mode: 0o644 });
    writePrivateFile(file, "new");
    expect(readFileSync(file, "utf8")).toBe("new");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("is written beside its target and renamed, never written in place", () => {
    /* A reader holding the old file open keeps the old bytes: the inode changes. */
    const file = path.join(dir, "atomic.html");
    writePrivateFile(file, "one");
    const before = statSync(file).ino;
    writePrivateFile(file, "two");
    expect(statSync(file).ino).not.toBe(before);
  });
});
