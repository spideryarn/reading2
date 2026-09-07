/**
 * **What kind of work a ledger row paid for** —
 * [src/cost-categories.ts](../src/cost-categories.ts).
 *
 * The whole file exists because the categories a pricing conversation *wants*
 * are not the ones `ai_calls` can prove, and the danger is a report that quietly
 * claims the difference. So the tests here are mostly about the two ways that
 * happens: a row landing in a category whose name asserts a provenance the
 * schema does not carry, and a row landing in a category nobody is looking at.
 */

import { describe, expect, it } from "vitest";

import {
  COST_CATEGORIES,
  type CostCategory,
  JOB_DISPOSITION,
  assertCategoriesCoverRows,
  costCategoryOf,
} from "../src/cost-categories.js";
import { AI_JOB_WIRE } from "../src/models.js";

describe("classifying one row", () => {
  it("calls a default pipeline step default-step work, by its STEP not its job", () => {
    /* `labels` runs inside the `hierarchy` step and is recorded
       `job: "labels", step_name: "hierarchy"`. A classifier that asked the job
       would put half of every default ingest in `unknown` — the step name is
       what says which pipeline slot was paid for. */
    expect(costCategoryOf({ scopeKind: "job_step", job: "labels", stepName: "hierarchy" })).toBe(
      "default-step work",
    );
    expect(costCategoryOf({ scopeKind: "job_step", job: "hierarchy", stepName: "hierarchy" })).toBe(
      "default-step work",
    );
  });

  it("separates a step that is off the default from one that is on it", () => {
    /* `arc` came off DEFAULT_INGEST_STEPS on 2026-08-29 and `glossary` was never
       on it. This is the split the pricing question turns on — what an upload
       costs, against what engagement costs — so it must come from the live list
       in src/pipeline.ts rather than from a copy. */
    expect(costCategoryOf({ scopeKind: "job_step", job: "glossary", stepName: "glossary" })).toBe(
      "on-demand enrichment",
    );
    expect(costCategoryOf({ scopeKind: "job_step", job: "arc", stepName: "arc" })).toBe(
      "on-demand enrichment",
    );
  });

  it("does not pretend a job_step row knows whether it was an upload or a rerun", () => {
    /* The row from a reader pressing "generate" on a stale hierarchy is
       byte-identical to the row from the first ingest — same scope, same job,
       same step. The category is therefore named for the mechanism, and this
       test is the statement that the two are deliberately indistinguishable
       rather than accidentally so. GPT Sol, 2026-09-02. */
    const initial = { scopeKind: "job_step", job: "hierarchy", stepName: "hierarchy" };
    const rerun = { ...initial };
    expect(costCategoryOf(initial)).toBe(costCategoryOf(rerun));
    expect(costCategoryOf(initial)).toBe("default-step work");
  });

  it("puts a reader's chat, search and referee calls in interactive request work", () => {
    for (const job of ["chat", "explain", "search", "quiz-mark", "referee-candidates", "embeddings"]) {
      expect(costCategoryOf({ scopeKind: "request", job, stepName: null })).toBe(
        "interactive request work",
      );
    }
  });

  it("counts a live conversation as voice even though it is recorded in request scope", () => {
    /* The one that would have gone wrong. `src/live.ts` records its usage with
       `scopeKind: "request"`, so a classifier that checked the scope before the
       job would fold the single most expensive thing the app does into the
       interactive bucket — the exact distinction the whole live-metering stage
       was built to make. */
    expect(costCategoryOf({ scopeKind: "request", job: "live_conversation", stepName: null })).toBe(
      "voice",
    );
  });

  it("counts an eval that exercises chat as non-product, not as a reader's chat", () => {
    /* An eval is recorded with the job it was imitating, so the scope has to
       win. A bake-off over forty PDF pages landing in the figure Greg prices
       against is how a price gets set wrong — the same argument `pocket()` in
       scripts/ai-cost.ts already makes for printing eval spend apart. */
    expect(costCategoryOf({ scopeKind: "eval", job: "chat", stepName: null })).toBe("non-product");
    expect(costCategoryOf({ scopeKind: "cli", job: "hierarchy", stepName: null })).toBe(
      "non-product",
    );
  });
});

describe("a job or step this build has never heard of", () => {
  it("lands in unknown rather than in the nearest plausible category", () => {
    /* **The guard the whole design turns on.** A new `AiJob` added next month
       must show up rather than be absorbed by whichever branch has the loosest
       `else`. The tempting shape — `if (scopeKind === "request") return
       "interactive …"` — passes every other test in this file and fails this
       one. */
    expect(costCategoryOf({ scopeKind: "request", job: "brand-new-mode", stepName: null })).toBe(
      "unknown",
    );
    expect(costCategoryOf({ scopeKind: "job_step", job: "whatever", stepName: "new-step" })).toBe(
      "unknown",
    );
  });

  it("puts a retired name from an old row in unknown too", () => {
    /* Real data: `data/_ai-calls.jsonl` on this box carries 34 rows of
       `job: "summarise", step_name: "summary"`, a stage that was split into
       `hierarchy` and `labels` long ago. Folding those into `default-step work`
       would be inventing provenance one rename later. */
    expect(costCategoryOf({ scopeKind: "job_step", job: "summarise", stepName: "summary" })).toBe(
      "unknown",
    );
  });

  it("puts a job_step row with no step name in unknown rather than guessing", () => {
    expect(costCategoryOf({ scopeKind: "job_step", job: "hierarchy", stepName: null })).toBe(
      "unknown",
    );
  });
});

describe("the classified-equals-total assertion", () => {
  const counts = (over: Partial<Record<CostCategory, number>>): Map<CostCategory, number> =>
    new Map(Object.entries(over) as [CostCategory, number][]);

  it("passes when every row is in some category", () => {
    expect(() =>
      assertCategoriesCoverRows(counts({ "default-step work": 3, unknown: 2 }), 5),
    ).not.toThrow();
  });

  it("fires when a job kind is unclassified and its rows never reach the page", () => {
    /* **The failure this exists for, spelled out.** Say a new job appears, its
       rows land in `unknown`, and the report's fold has no bucket for `unknown`
       — the per-category table then adds up to less than the ledger returned,
       and every figure on the page is quietly short while nothing anywhere is
       red. A pricing report that is smaller than the truth and looks reasonable
       is worse than no report. */
    expect(() => assertCategoriesCoverRows(counts({ "default-step work": 3 }), 5)).toThrow(
      /covers 3 call\(s\) and the ledger returned 5/,
    );
  });

  it("fires when a category name arrives that this build does not know", () => {
    /* The other direction, and it would otherwise pass the addition above while
       its rows never appeared on the page: a renamed category whose old spelling
       is still being written somewhere. */
    const stray = new Map([["reader uploads", 5]]) as unknown as Map<CostCategory, number>;
    expect(() => assertCategoriesCoverRows(stray, 5)).toThrow(/does not know about/);
  });

  it("does not fire merely because unknown has rows in it", () => {
    /* Deliberate. `unknown` holding rows is an expected state — retired job
       names — and a check that failed on it would be muted within a week, which
       would take the check above down with it. The report prints what is in
       there instead. */
    expect(() => assertCategoriesCoverRows(counts({ unknown: 9 }), 9)).not.toThrow();
  });
});

describe("the category list itself", () => {
  it("ends with unknown, because it is the exhaustive one", () => {
    expect(COST_CATEGORIES[COST_CATEGORIES.length - 1]).toBe("unknown");
  });

  it("names nothing that claims a provenance the schema cannot supply", () => {
    /* Prose in a test, and worth it: these five names were rewritten after GPT
       Sol showed the original set ("base upload", "reader-triggered rerun") was
       underivable. A future edit that puts "upload" back into a category name is
       reintroducing that claim, and this is the line that argues with it. */
    for (const name of COST_CATEGORIES) {
      expect(name).not.toMatch(/upload|rerun|initial|first/i);
    }
  });
});

/**
 * **Every `AiJob` has to be placed by hand** — `JOB_DISPOSITION` in
 * [src/cost-categories.ts](../src/cost-categories.ts).
 *
 * The classifier already enumerated request-scope jobs rather than catching
 * them, precisely so that a new `AiJob` would land in `unknown` instead of
 * being absorbed by the widest `else`, and its comment called that *"a nuisance
 * that lasts one line of edit and is the entire point."*
 *
 * The design was right and the delivery was not. The nuisance is only delivered
 * to somebody who runs `npm run cost` and reads the `UNCLASSIFIED` block —
 * and `link-summary`, a live reader-facing feature (docs/project/links.md),
 * sat there unclassified from the day it shipped, at $0.0030 across 9 calls.
 * Trivial money, which is exactly why nobody looked. The check existed, agreed,
 * and was not read: docs/reusable/silent-success.md.
 *
 * So the table below is `Record<AiJob, …>`, and the guard is the **compiler** —
 * adding a job without placing it is a build error, delivered to the person who
 * added it. GPT Sol's F4, 2026-09-07, made it four-valued rather than a
 * yes/no: `AI_JOB_WIRE` is transport inventory, not scope inventory, and a
 * binary split would have encoded the wrong fact about `pdf`, `pdf-frontmatter`
 * and `illustrate`, which run inside pipeline steps and are classified by their
 * step name.
 */
describe("placing every job the app can bill for", () => {
  it("classifies link-summary as interactive request work, which it did not until 2026-09-07", () => {
    /* The one-line fix the report had been asking for since the feature
       shipped. `npm run cost -- --owners --all` printed exactly this row under
       UNCLASSIFIED: `request / link-summary / —  9 call(s)  $0.0030`. */
    expect(costCategoryOf({ scopeKind: "request", job: "link-summary", stepName: null })).toBe(
      "interactive request work",
    );
  });

  it("places every job in AI_JOB_WIRE, so a new one cannot arrive unplaced", () => {
    /* The compiler already refuses an unplaced job — this is the runtime half,
       and it earns its place by catching what the compiler cannot: a widening
       cast, or a job added to AI_JOB_WIRE through a spread that TypeScript
       accepts structurally. The two tables are independent statements about the
       same set and must agree. */
    const wired = Object.keys(AI_JOB_WIRE).sort();
    const placed = Object.keys(JOB_DISPOSITION).sort();
    expect(placed).toEqual(wired);
  });

  it("agrees with the classifier about which jobs are interactive", () => {
    /* The table is the source and `costCategoryOf` is the consumer; a job marked
       interactive that the classifier does not recognise would be a table nobody
       reads. Checked in both directions on purpose. */
    for (const [job, disposition] of Object.entries(JOB_DISPOSITION)) {
      const category = costCategoryOf({ scopeKind: "request", job, stepName: null });
      if (disposition === "interactive request work") {
        expect(category).toBe("interactive request work");
      } else if (disposition === "voice") {
        expect(category).toBe("voice");
      } else {
        /* Step-driven and no-product jobs are not *expected* in request scope.
           If one turns up there anyway the row is visible rather than absorbed,
           which is the whole design — the table says what a job is expected to
           do and never overrides what a row actually says. */
        expect(category).toBe("unknown");
      }
    }
  });

  it("still sends a step-driven job to its step's category when it runs as a step", () => {
    /* The other half of the sentence above. `pdf` is step-driven, and a real
       `job_step / pdf / extract` row — 269 of them in the dev ledger — is
       default-step work because `extract` is in DEFAULT_INGEST_STEPS. The
       disposition table must not have taken that over. */
    expect(costCategoryOf({ scopeKind: "job_step", job: "pdf", stepName: "extract" })).toBe(
      "default-step work",
    );
    expect(costCategoryOf({ scopeKind: "job_step", job: "illustrate", stepName: "illustrated" })).toBe(
      "on-demand enrichment",
    );
  });

  it("keeps an eval overlay non-product whatever the job is", () => {
    /* An eval that exercises `chat` is recorded `job: "chat"`, and the scope is
       checked before the job for that reason. The disposition table must not
       have moved that check. */
    expect(costCategoryOf({ scopeKind: "eval", job: "chat", stepName: null })).toBe("non-product");
    expect(costCategoryOf({ scopeKind: "eval", job: "link-summary", stepName: null })).toBe(
      "non-product",
    );
  });
});
