/**
 * **The `quiz` step's registration, asked as effects rather than as lists.**
 *
 * Adding a stage to this pipeline means filling in about twenty tables. Most of
 * them the compiler demands and they look after themselves. Two do not, and
 * both fail the same way — silently, with a perfectly good artefact written
 * every time and nothing anywhere going red:
 *
 * 1. **the stamp field names inside the artefact.** `stampOf`
 *    (src/store/artifacts.ts) reads `sourceHash`, `version` and `generator` off
 *    the JSON. `inputHash`, `promptVersion` and `model` are the in-memory
 *    `StepStamp` names and appear nowhere on disk. Spell them the second way
 *    and `stampOf` returns `{}`, `sameStamp` answers false on every comparison,
 *    and the step re-runs on every job for ever.
 * 2. **a `STAMP_SOURCE` row that says the wrong thing**, which makes `stampFor`
 *    answer `null` for exactly the same result, one door along. A *missing* row
 *    is a typecheck error since that table went total (src/store/artifacts.ts),
 *    but `quiz: null` — "this step stamps nothing" — still compiles and still
 *    costs a model call on every job for ever, so this file keeps asking.
 *
 * The first draft of the plan had bug 1 in it; GPT Sol caught it before a line
 * was written. Neither is visible to a test that the artefact parses, or that
 * the ids resolve, or that the panel draws — all of which stay green.
 *
 * So this file asks the question those tests cannot: **run the stage for real,
 * write what it produced through the store, and then ask the store what stamp
 * it recorded.** If either bug were present, `stampFor` answers `null` or `{}`
 * and `stepIsDone` says the step is not current — which is the whole of the
 * failure, and is one assertion.
 *
 * `tests/stage-stamp-agreement.test.ts` is the neighbour and asks a different
 * half: that the hash the stage *writes* equals the hash its `stamp`
 * *computes*. That one never touches the store, so it cannot see either of the
 * two bugs above. Both files are needed and neither subsumes the other.
 *
 * The model is stubbed, so the real `generateQuiz` runs end to end and nothing
 * reaches the network. Harness copied from
 * tests/late-step-on-a-cold-instance.test.ts.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { readArticle } from "../src/article-input.js";
import { isBodyEvidence } from "../src/block-policy.js";
import { STEPS, stepIsDone } from "../src/pipeline.js";
import type { StepContext } from "../src/pipeline.js";
import { createFsArtifactStore } from "../src/store/artifacts-fs.js";
import { BASELINE, STAMP_SOURCE } from "../src/store/artifacts.js";
import type { ArtifactStore } from "../src/store/artifacts.js";
import type { Quiz } from "../src/types.js";

/* ------------------------------------------------------- the stubbed model -- */

/**
 * Every model call this file allows, and **the counter is the spend meter**.
 *
 * `streamMessage` is the only way `generateQuiz` can cost anything — it is what
 * writes the `ai_calls` row (src/messages-stream.ts) — so "records zero model
 * spend" and "never called this function" are the same claim, measured at the
 * one place a charge can be incurred. Counting the calls rather than reading a
 * ledger keeps the test hermetic and asks the stronger question: a run that
 * skipped but called the model anyway would be a passing ledger check and a
 * failing one here.
 */
const answers: string[] = [];
let calls = 0;

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: () => {
      calls++;
      const text = answers.shift();
      if (text === undefined) throw new Error("the stub ran out of scripted answers");
      const message = {
        id: "msg_stub",
        type: "message",
        role: "assistant",
        model: "stub",
        content: [{ type: "text", text, citations: null }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
      return {
        onText: () => undefined,
        aborted: () => false,
        finalMessage: () => Promise.resolve(message),
      };
    },
  };
});

/* --------------------------------------------------------------- the fixture -- */

const REPO = path.resolve(import.meta.dirname, "..");
const SLUG = "noema-mythology-of-conscious-ai";

let root = "";
let store: ArtifactStore;

function ctxFor(): StepContext {
  return {
    slug: SLUG,
    dir: path.join(root, "data", SLUG),
    htmlFile: path.join(root, "output", `${SLUG}.html`),
    report: () => undefined,
    signal: new AbortController().signal,
    cacheArticle: false,
  };
}

/**
 * What the stubbed model answers: **four questions**, each anchored to a real
 * block with a real quote, one of them `easy` and one `hard`.
 *
 * Four rather than one, and the bands rather than whatever: `SPREAD_FROM` is
 * four, so a batch of four is required to carry one of each end and `buildQuiz`
 * throws otherwise. Reaching that requirement here rather than dodging it is
 * deliberate — the artefact this file stamps is one a real run could have
 * produced.
 */
async function script(): Promise<void> {
  const article = await readArticle(SLUG, store);
  const usable = article.blocks.filter(isBodyEvidence).filter((b) => b.text.length > 120);
  if (usable.length < 4) throw new Error("the fixture has too few quotable blocks");
  const bands = ["easy", "easy", "hard", "hard"] as const;
  answers.length = 0;
  answers.push(
    JSON.stringify({
      questions: usable.slice(0, 4).map((block, i) => ({
        question: `What does the piece say in passage ${i + 1}?`,
        referenceAnswer: "It says the quoted thing. Then it moves on to the next point.",
        band: bands[i],
        value: 5 - i,
        evidence: [{ blockId: block.id, quote: block.text.slice(0, 60) }],
      })),
    }),
  );
}

/** Run the stage for real and write what it produced, exactly as `jobs.ts` does. */
async function runAndWrite(): Promise<Quiz> {
  await script();
  const ctx = ctxFor();
  const result = await STEPS.quiz.run(ctx, store, nullCheckpointStore());
  /* The stub ran short if anything is left — a silent way for the stage to have
     taken a path this file did not intend. */
  expect(answers).toEqual([]);
  const quiz = result.parts?.quiz as Quiz;
  const stamp = await STEPS.quiz.stamp?.(ctx, store);
  /* A `null` stamp means the store could not read the article, which cannot
     happen here and would make every assertion below vacuous if it did. */
  if (!stamp) throw new Error("the quiz step's stamp answered null for a readable article");
  await store.write(SLUG, "quiz", { quiz }, stamp);
  return quiz;
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "spya-quiz-"));
  await cp(path.join(REPO, "example"), path.join(root, "data", SLUG), { recursive: true });
  store = createFsArtifactStore((slug) => ({
    dir: path.join(root, "data", slug),
    htmlFile: path.join(root, "output", `${slug}.html`),
  }));
}, 30_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  calls = 0;
  await rm(path.join(root, "data", SLUG, "quiz.json"), { force: true });
  await rm(path.join(root, "data", SLUG, "steps"), { recursive: true, force: true });
  /* The last test moves a block's text on purpose. Put it back, so the order
     these run in cannot change what any of them is asking. */
  await cp(
    path.join(REPO, "example", "blocks.json"),
    path.join(root, "data", SLUG, "blocks.json"),
  );
});

describe("what the store records when the quiz step has run", () => {
  it("names the quiz artefact in STAMP_SOURCE, and does not say null", () => {
    /* Stated on its own because it is the one that fails *before* anything can
       be measured: with `null` or the wrong kind, `stampFor` returns `null` for
       every article and the assertion below would fail for a reason nobody
       would read as this. The row can no longer be *absent* — the table is
       `Record<StepName, ArtifactKind | null>` and the compiler demands one —
       so what is left to get wrong is the value, which is what this asks. */
    expect(STAMP_SOURCE.quiz).toBe("quiz");
  });

  it("stamps a quiz it can read back, and the stamp is the one the step expects", async () => {
    await runAndWrite();

    const recorded = await store.stampFor(SLUG, "quiz");
    const expected = await STEPS.quiz.stamp?.(ctxFor(), store);

    /* **Non-empty first, and separately.** `{}` and `{}` are deeply equal, and
       an empty stamp on both sides is exactly the shape of the field-name bug —
       so an equality assertion on its own would go green on the failure this
       whole file is about. */
    expect(recorded, "stampFor answered null — is there a STAMP_SOURCE row?").not.toBeNull();
    expect(recorded?.inputHash, "the artefact carries no sourceHash").toEqual(expect.any(String));
    expect(recorded?.promptVersion, "the artefact carries no version").toEqual(expect.any(String));
    expect(recorded?.model, "the artefact carries no generator").toEqual(expect.any(String));

    expect(recorded).toEqual(expected);
  });

  it("spells the three stamp fields the store's way and not the StepStamp way", async () => {
    const quiz = (await runAndWrite()) as unknown as Record<string, unknown>;
    /* The other half of the same bug, asked of the bytes. `stampOf` reads these
       three names and no others; the in-memory names on disk would make every
       comparison false while the artefact went on parsing perfectly. */
    for (const name of ["sourceHash", "version", "generator"]) {
      expect(quiz, `${name} is the on-disk name and must be present`).toHaveProperty(name);
    }
    for (const wrong of ["inputHash", "promptVersion", "model"]) {
      expect(quiz, `${wrong} is the in-memory name and must not be on disk`).not.toHaveProperty(
        wrong,
      );
    }
  });
});

describe("running the step again", () => {
  it("skips, and spends nothing, when nothing has moved", async () => {
    await runAndWrite();

    calls = 0;
    /* `stepIsDone` is the whole of the unforced decision — src/jobs.ts calls
       exactly this and skips on `true` (§ `runOneStep`). Asking it here rather
       than driving the job runner keeps the test about the registration rather
       than about the queue. */
    const done = await stepIsDone(STEPS.quiz, ctxFor(), store);
    expect(done, "a quiz written a moment ago is not current").toBe(true);

    /* **Zero model spend, measured at the only place a charge can happen.** The
       failure this guards against is not a crash: it is the step running again
       on every job for ever, writing a perfectly good artefact each time. */
    expect(calls, "deciding whether to skip must not call the model").toBe(0);
  });

  it("does not skip when the article moves underneath it", async () => {
    /* **The negative control.** Without it, the assertion above would pass on a
       `stepIsDone` that answered `true` unconditionally — which is the same
       feature broken the other way, and much worse: a stale quiz served for
       ever with a green tick over it. */
    await runAndWrite();

    const at = path.join(root, "data", SLUG, "blocks.json");
    const file = JSON.parse(await readFile(at, "utf-8")) as { blocks: { text: string }[] };
    const first = file.blocks[0];
    if (!first) throw new Error("the fixture has no blocks");
    first.text = `${first.text} — and one more sentence the quiz never saw.`;
    await writeFile(at, JSON.stringify(file, null, 2));

    expect(await stepIsDone(STEPS.quiz, ctxFor(), store)).toBe(false);
  });
});

describe("what the quiz step deliberately does not register", () => {
  it("has no BASELINE row, because it inherits no ids", () => {
    /* Not an omission — `readBaseline` **throws** for a kind with no row, which
       is the point: a stage that half-inherits is a stage whose ids move
       between runs while something goes on linking to them. `quiz` has no
       consumer that outlives its batch (no stored attempts, no `?quiz=<id>`),
       so a row here would be machinery serving nothing — and the mark route's
       409 is what covers the gap it leaves.
       docs/plans/260831al-review-quiz-sub-mode.md. */
    expect(BASELINE.quiz).toBeUndefined();
  });
});
