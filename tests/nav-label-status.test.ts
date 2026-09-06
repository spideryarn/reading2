/**
 * **The "still arriving" state, and the three places it can drift.**
 *
 * `NavLabelStatus` (src/types.ts) is one enum written down in four different
 * languages: a TypeScript union, a Drizzle `$type`, a CHECK expression in a
 * `.sql` file, and a `switch` in the browser. No compiler reads more than one of
 * them, and each of the three ways they can part is quiet in its own way:
 *
 * - **The CHECK against the union.** `drizzle-kit generate` diffs the
 *   TypeScript and knows nothing about a CHECK expression, which is exactly how
 *   `revision_step_runs_step` has drifted twice
 *   (tests/db-step-constraint.test.ts, and every migration that touches it
 *   carries a warning about the last time). A fourth member added to the union
 *   would compile, migrate cleanly, and be rejected at the UPDATE with a
 *   `23514 check_violation` naming none of this.
 * - **The carry-forward policy.** A column with no entry throws at module load
 *   (`carriedColumns` in src/store/pg-revisions.ts), so *unclassified* is loud.
 *   *Classified wrongly* is silent, and for this column the wrong answer has a
 *   direction: `mint` resets a `pending` article to `ready` on every draft and
 *   loses the fact that a run is owed.
 * - **The client rule.** `paragraphLabelsReady` is what decides whether the
 *   paragraph label layer is drawn at all, and getting it wrong draws a run of
 *   blank cells that reports our unfinished work as the article's own structure
 *   (src/web/nav-labels.ts). The two cases below are the ones a rewrite would
 *   most plausibly break.
 *
 * **Static, and reading the migrations rather than a database** — the same
 * instrument and the same argument as tests/db-step-constraint.test.ts: it
 * answers the moment the file is written, and it cannot skip itself on a laptop
 * with Supabase down. Whether the live database actually matches is
 * tests/db-schema.test.ts's job. tests/nav-label-status-pg.test.ts is the
 * round trip.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readJournal } from "../scripts/migration-ledger.js";
import { REVISION_CARRY_POLICY } from "../src/store/pg-revisions.js";
import { NAV_LABEL_STATUSES, type NavLabelStatus } from "../src/types.js";
import { paragraphLabelNotice, paragraphLabelsReady, paragraphPill } from "../src/web/nav-labels.js";

const DRIZZLE = path.resolve(import.meta.dirname, "..", "drizzle");
const CONSTRAINT = "article_revisions_nav_label_status";

/** Every `.sql` migration, in journal order — see tests/db-step-constraint.test.ts. */
function migrations(): { file: string; sql: string }[] {
  return readJournal(DRIZZLE)
    .map((e) => `${e.tag}.sql`)
    .filter((file) => existsSync(path.join(DRIZZLE, file)))
    .map((file) => ({ file, sql: readFileSync(path.join(DRIZZLE, file), "utf-8") }));
}

/**
 * The values inside the **last** `ADD CONSTRAINT … CHECK (… in (…))` for this
 * constraint, which is the one the database ends up with.
 *
 * Anchored on `ADD CONSTRAINT` for the reason its twin is: a migration that
 * re-states the constraint also contains a `DROP CONSTRAINT` naming it, and a
 * match on the drop would find no list and report the constraint as empty.
 */
function declaredStatuses(): { file: string; statuses: string[] } | null {
  let found: { file: string; statuses: string[] } | null = null;
  for (const { file, sql } of migrations()) {
    const re = new RegExp(`ADD CONSTRAINT "${CONSTRAINT}"[\\s\\S]*?in \\(([^)]*)\\)`, "g");
    let m: RegExpExecArray | null = re.exec(sql);
    while (m) {
      found = {
        file,
        statuses: (m[1] ?? "")
          .split(",")
          .map((s) => s.trim().replace(/^'|'$/g, ""))
          .filter(Boolean),
      };
      m = re.exec(sql);
    }
  }
  return found;
}

describe("the nav_label_status CHECK", () => {
  it("is declared by some migration at all", () => {
    /* Red first: without this, a regex that stopped matching would make every
       assertion below vacuous rather than red. */
    expect(declaredStatuses()).not.toBeNull();
  });

  it("lists exactly the three values NavLabelStatus has", () => {
    const found = declaredStatuses();
    expect(found).not.toBeNull();
    expect([...(found as { statuses: string[] }).statuses].sort()).toEqual(
      [...NAV_LABEL_STATUSES].sort(),
    );
  });

  it("names the migration that would have to change, when it is wrong", () => {
    /* An assertion about the *message* rather than about behaviour, exactly as
       tests/db-step-constraint.test.ts makes: somebody who trips the case above
       has to be able to open the file without reading eighty migrations. */
    const file = (declaredStatuses() as { file: string }).file;
    expect(file).toMatch(/\.sql$/);
    expect(existsSync(path.join(DRIZZLE, file))).toBe(true);
  });

  it("is spelled the same way in src/db/schema.ts, which is a second hand-kept copy", () => {
    /* **The gap this closes, and it was a review finding rather than a
       precaution.** The migration is the truth and `schema.ts` carries a
       `check(...)` literal beside the column that no compiler compares to it —
       so the two could part, and the assertions above would go on passing
       because they only ever read `drizzle/`. `schema.ts`'s own comment already
       claimed "tests/nav-label-status.test.ts compares the two"; until this
       case it did not. GPT Sol's F1 on stage 1, 2026-09-06.

       Read as text rather than by importing the table, because a Drizzle
       `check()` holds its expression as an opaque `SQL` object: importing gives
       you a builder, not the string a reader would diff. Same instrument as
       `declaredStatuses` above, pointed at a different file. */
    const schema = readFileSync(
      path.resolve(import.meta.dirname, "..", "src", "db", "schema.ts"),
      "utf-8",
    );
    const m = new RegExp(`"${CONSTRAINT}"[\\s\\S]*?in \\(([^)]*)\\)`).exec(schema);
    expect(m, `no ${CONSTRAINT} CHECK literal found in src/db/schema.ts`).not.toBeNull();
    const inSchema = (m?.[1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
    expect([...inSchema].sort()).toEqual([...NAV_LABEL_STATUSES].sort());
  });

  it("adds the column without touching the step constraint", () => {
    /* The one thing this migration must NOT do. `revision_step_runs_step` has to
       be dropped and re-added by anything that changes it, and a migration that
       re-stated it while adding an unrelated column would be a second, invisible
       chance to lose a step name — which is the failure
       tests/db-step-constraint.test.ts exists for. This adds no step, so it
       should not mention that constraint at all. */
    const file = (declaredStatuses() as { file: string }).file;
    /* **The statements, not the file.** These migrations carry long `--`
       headers, and this one's names `revision_step_runs_step` on purpose — to
       say it is deliberately not touching it. Matching the whole file would make
       the header's honesty fail the test. */
    const statements = readFileSync(path.join(DRIZZLE, file), "utf-8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements).toContain('ADD COLUMN "nav_label_status"');
    expect(statements).toContain("DEFAULT 'ready' NOT NULL");
    expect(statements).not.toContain("revision_step_runs_step");
  });
});

describe("the carry-forward policy", () => {
  it("carries the status, so it travels with the labels it is about", () => {
    /* `carry` and not `mint`: a `{ steps: ["blocks"] }` job copies `tree` and
       `labels` into the new draft, and a status that reset to the column default
       would say `ready` over labels the draft inherited from a run that never
       finished — or lose a `pending` that says a run is still owed. */
    expect(REVISION_CARRY_POLICY.navLabelStatus).toBe("carry");
    expect(REVISION_CARRY_POLICY.labels).toBe("carry");
    expect(REVISION_CARRY_POLICY.tree).toBe("carry");
  });
});

describe("what the client does with it", () => {
  it("draws the layer only when the labels are ready", () => {
    expect(paragraphLabelsReady("ready")).toBe(true);
    expect(paragraphLabelsReady("pending")).toBe(false);
    expect(paragraphLabelsReady("failed")).toBe(false);
  });

  it("withholds the layer for a value it does not recognise", () => {
    /* **The direction this is written in is the whole point.** `=== "ready"`
       and not `!== "pending"`: a fourth member of the union that nobody thought
       about here, or a value the CHECK somehow let through, must cost the reader
       the column rather than give them a run of blank cells. The cast is how a
       state the type system forbids is reached at all — which is the state this
       is about. */
    expect(paragraphLabelsReady("arriving" as NavLabelStatus)).toBe(false);
  });

  it("leaves a way to close a withheld column that is already open", () => {
    /* **The bug this pins, which a component test of the table could not see.**
       `toggle` in App.tsx is the only caller of `setCols`, so replacing the pill
       with the sentence removed the only way to *close* the leaf column as well
       as the only way to open it. The column can already be open without the
       pill having done it — a `?cols=` naming the leaf depth, shared or
       bookmarked — and that reader was left with a wide column of one repeated
       sentence and nothing to shut it with. For ever, if the status is `failed`.
       GPT Sol's F2 on stage 1, 2026-09-06. */
    expect(paragraphPill("pending", true)).toBe("toggle");
    expect(paragraphPill("failed", true)).toBe("toggle");
  });

  it("still refuses to open a column onto nothing", () => {
    /* The other half, and the case the sentence was written for: while the
       column is shut, the pill would open it onto a run of one repeated notice.
       That is what the notice replaces. */
    expect(paragraphPill("pending", false)).toBe("notice");
    expect(paragraphPill("failed", false)).toBe("notice");
  });

  it("is the ordinary pill whenever the labels are there", () => {
    expect(paragraphPill("ready", false)).toBe("toggle");
    expect(paragraphPill("ready", true)).toBe("toggle");
  });

  it("says nothing at all when there is nothing to say", () => {
    /* `null` rather than an empty string, so the caller branches on presence and
       cannot render a blank chip where a pill should be (src/web/App.tsx). */
    expect(paragraphLabelNotice("ready")).toBeNull();
  });

  it("tells the two absences apart, without repeating anything upstream said", () => {
    const pending = paragraphLabelNotice("pending");
    const failed = paragraphLabelNotice("failed");
    expect(pending).toBeTruthy();
    expect(failed).toBeTruthy();
    /* Two sentences, not one: *still arriving* is a thing that finishes and
       *aren't available* is a thing that does not, and a reader who is told the
       wrong one waits for something that is not coming. */
    expect(pending).not.toBe(failed);
    /* No bracketed code — these are not failures a model call returned, so they
       follow src/job-state.ts rather than src/messages.ts. A code would invite a
       bug report about a pipeline doing what a pipeline does.
       docs/project/copy.md § The bracketed code. */
    for (const line of [pending, failed]) {
      expect(line).not.toMatch(/\[/);
      /* And short. A sentence in a controls bar that wraps is a bar that grows. */
      expect((line as string).length).toBeLessThan(60);
    }
  });
});
