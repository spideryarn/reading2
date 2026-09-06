/**
 * **The `debate` step's registration, asked as effects rather than as lists** —
 * the shape `tests/quiz-step-registration.test.ts` established, applied to the
 * one stage that is not on the Messages wire.
 *
 * Adding a stage means filling in about twenty tables. Most the compiler demands
 * and they look after themselves. The ones that do not fail the same way —
 * silently, with a perfectly good artefact written every time and nothing going
 * red:
 *
 * 1. **the stamp field names inside the artefact.** `stampOf`
 *    (src/store/artifacts.ts) reads `sourceHash`, `version` and `generator` off
 *    the JSON. `inputHash`, `promptVersion` and `model` are the in-memory
 *    `StepStamp` names and appear nowhere on disk. Spell them the second way and
 *    `sameStamp` answers false on every comparison and the step re-runs for
 *    ever — at up to $0.27 a run, which is what makes this file worth more here
 *    than it is for the quiz;
 * 2. **a `STAMP_SOURCE` row that says the wrong thing**, which makes `stampFor`
 *    answer `null` for the same result one door along. A *missing* row is a
 *    typecheck error; `debate: null` still compiles;
 * 3. **the model in the stamp.** This is the one stamped stage whose model can
 *    be overridden by the environment (`SPIDERYARN_DEBATE_MODEL`), so the stamp
 *    has to resolve `modelFor("debate")` rather than compare against
 *    `CAPABLE_MODEL` — which is the constant every neighbouring stage uses and
 *    the obvious thing to copy. Getting that wrong reports every run stale on a
 *    machine with the override set, and on no other.
 *
 * None of the three is visible to a test that the artefact parses, or that the
 * rows validate, or that the panel draws.
 *
 * The model is stubbed at `openRouterJson`, which is the only way this stage can
 * cost anything — so *"records zero model spend"* and *"never called this
 * function"* are the same claim, measured where the charge is incurred.
 *
 * docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md § Stage 2
 */
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { nullCheckpointStore } from "../src/store/checkpoints.js";

/* --------------------------------------------------------- the stubbed model -- */

const answers: unknown[] = [];
let calls = 0;

vi.mock("../src/ai-call.js", () => ({
  openRouterJson: () => {
    calls++;
    const next = answers.shift();
    if (next === undefined) throw new Error("the stub ran out of scripted answers");
    return Promise.resolve({ json: next, answeredBy: null, generationId: null });
  },
}));

const { readArticle } = await import("../src/article-input.js");
const { isBodyEvidence } = await import("../src/block-policy.js");
const { CAPABLE_MODEL, modelFor } = await import("../src/models.js");
const { STEPS, stepIsDone } = await import("../src/pipeline.js");
const { BASELINE, STAMP_SOURCE } = await import("../src/store/artifacts.js");
const { memoryArtefactsFrom } = await import("./helpers/memory-artefacts.js");
import type { StepContext } from "../src/pipeline.js";
import type { MemoryArtifactStore } from "./helpers/memory-artefacts.js";
import type { Debate } from "../src/types.js";

/* ----------------------------------------------------------------- fixture -- */

const REPO = path.resolve(import.meta.dirname, "..");
const SLUG = "noema-mythology-of-conscious-ai";

let root = "";
let store: MemoryArtifactStore;

function ctxFor(): StepContext {
  return {
    slug: SLUG,
    report: () => undefined,
    signal: new AbortController().signal,
    cacheArticle: false,
  };
}

/**
 * A whole chat completion, with the annotation the row cites attached.
 *
 * **The row has to survive validation**, and that is deliberate rather than
 * incidental: an artefact with two empty groups is a perfectly good one here —
 * it is the commonest real outcome — so a stub whose quotations stopped matching
 * would write an empty debate carrying a perfectly good `sourceHash`, and every
 * assertion below would go on passing while testing nothing.
 * docs/reusable/silent-success.md.
 */
function completion(rows: unknown[], page: { url: string; title: string; content: string }) {
  return {
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: "```debate\n" + JSON.stringify(rows) + "\n```",
          annotations: [{ type: "url_citation", url_citation: page }],
        },
      },
    ],
    usage: { server_tool_use: { web_search_requests: 3 } },
  };
}

/**
 * What the stubbed searches answer: one direct row and one claim row, both
 * anchored to real prose out of the fixture rather than typed here.
 */
async function script(): Promise<void> {
  const article = await readArticle(SLUG, store);
  const block = article.blocks.filter(isBodyEvidence).find((b) => b.text.length > 160);
  if (!block) throw new Error("the fixture has no block long enough to quote");
  const title = article.meta?.title ?? "";
  if (!title) throw new Error("the fixture has no title for a witness to name");

  const review = {
    url: "https://example.invalid/a-reply",
    title: "A reply",
    content: `Writing about ${title}, one has to say the argument moves too fast in places.`,
  };
  const survey = {
    url: "https://example.invalid/on-the-topic",
    title: "On the topic",
    content: block.text.slice(0, 200),
  };

  answers.length = 0;
  answers.push(
    completion(
      [
        {
          url: review.url,
          sourceQuote: "the argument moves too fast in places",
          articleReferenceQuote: title,
          relation: "qualifies",
          valence: "negative",
          applies: "It accepts the case and objects to the pace.",
        },
      ],
      review,
    ),
    completion(
      [
        {
          url: survey.url,
          blockId: block.id,
          claimQuote: block.text.slice(0, 60),
          sourceQuote: block.text.slice(0, 60),
          relation: "corroborates",
          valence: "positive",
          applies: "It says the same thing about the same claim.",
        },
      ],
      survey,
    ),
  );
}

/** Run the stage for real and write what it produced, exactly as `jobs.ts` does. */
async function runAndWrite(): Promise<Debate> {
  await script();
  const ctx = ctxFor();
  const result = await STEPS.debate.run(ctx, store, nullCheckpointStore());
  /* The stub ran short if anything is left — a silent way for the stage to have
     taken a path this file did not intend. In particular, a stage that stopped
     running pass B would leave one answer here and every assertion below would
     still pass. */
  expect(answers).toEqual([]);
  const debate = result.parts?.debate as Debate;
  const stamp = await STEPS.debate.stamp?.(ctx, store);
  if (!stamp) throw new Error("the debate step's stamp answered null for a readable article");
  await store.write(SLUG, "debate", { debate }, stamp);
  return debate;
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "spya-debate-"));
  await cp(path.join(REPO, "example"), path.join(root, "data", SLUG), { recursive: true });
}, 30_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  calls = 0;
  answers.length = 0;
  store = await memoryArtefactsFrom(root, SLUG);
});

/* -------------------------------------------------------------- the stamp -- */

describe("what the store records when the debate step has run", () => {
  it("names the debate artefact in STAMP_SOURCE, and does not say null", () => {
    expect(STAMP_SOURCE.debate).toBe("debate");
  });

  /**
   * **And deliberately no `BASELINE` row.** Nothing outlives a run to inherit an
   * id — marks in the prose are not in v1 — so inheritance here would be
   * machinery serving nothing, and `readBaseline` throws for a kind with no row
   * precisely so nobody can half-add it. The `quiz` stage made the same call and
   * its own file asserts the same absence.
   */
  it("has no BASELINE row, because nothing inherits an id here", () => {
    expect(BASELINE).not.toHaveProperty("debate");
  });

  it("stamps a debate it can read back, and the stamp is the one the step expects", async () => {
    await runAndWrite();

    const recorded = await store.stampFor(SLUG, "debate");
    const expected = await STEPS.debate.stamp?.(ctxFor(), store);

    /* **Non-empty first, and separately.** `{}` and `{}` are deeply equal, and
       an empty stamp on both sides is exactly the shape of the field-name bug —
       so an equality assertion alone would go green on the failure this file is
       about. */
    expect(recorded, "stampFor answered null — is there a STAMP_SOURCE row?").not.toBeNull();
    expect(recorded?.inputHash, "the artefact carries no sourceHash").toEqual(expect.any(String));
    expect(recorded?.promptVersion, "the artefact carries no version").toEqual(expect.any(String));
    expect(recorded?.model, "the artefact carries no generator").toEqual(expect.any(String));

    expect(recorded).toEqual(expected);
  });

  it("spells the three stamp fields the store's way and not the StepStamp way", async () => {
    const debate = (await runAndWrite()) as unknown as Record<string, unknown>;
    for (const name of ["sourceHash", "version", "generator"]) {
      expect(debate, `${name} is the on-disk name and must be present`).toHaveProperty(name);
    }
    for (const wrong of ["inputHash", "promptVersion", "model"]) {
      expect(debate, `${wrong} is the in-memory name and must not be on disk`).not.toHaveProperty(
        wrong,
      );
    }
  });

  /**
   * **The model in the stamp is the one this task resolves to, not
   * `CAPABLE_MODEL`.**
   *
   * **The override is set here, and that is the whole test** (GPT Sol's F32).
   * Until 2026-09-05 this asserted `debate.generator === modelFor("debate")` on
   * a bare machine, where the two are the same string — so a stage that had
   * copied `model: CAPABLE_MODEL` in from the door next door passed it, which
   * is the one failure the case is named for. With `SPIDERYARN_DEBATE_MODEL`
   * set the two answers differ, and only a stage that really asks the resolver
   * can give the right one.
   */
  it("stamps the model this task resolves to, not the constant next door", async () => {
    vi.stubEnv("SPIDERYARN_DEBATE_MODEL", "test-only/debate-override");
    try {
      /* The premise, asserted rather than assumed: with the override in place
         the resolver and the constant are two different strings, so the
         assertion below can tell them apart. */
      expect(modelFor("debate")).toBe("test-only/debate-override");
      expect(modelFor("debate")).not.toBe(CAPABLE_MODEL);

      const debate = await runAndWrite();
      expect(debate.generator).toBe("test-only/debate-override");
      const stamp = await STEPS.debate.stamp?.(ctxFor(), store);
      expect(stamp?.model).toBe("test-only/debate-override");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

/* ------------------------------------------------------------- the artefact -- */

describe("the artefact the step writes", () => {
  it("carries both groups, each with its own counts", async () => {
    const debate = await runAndWrite();

    expect(debate.direct.counts.keptRows).toBe(1);
    expect(debate.claims.counts.keptRows).toBe(1);
    /* Per group, never only summed — a foot line cannot otherwise say which of
       the two searches lost rows. */
    expect(debate.direct.counts.webSearches).toBe(3);
    expect(debate.claims.counts.webSearches).toBe(3);
    expect(Date.parse(debate.searchedAt)).not.toBeNaN();
  });

  /**
   * The step made **two** calls, and one of them was for the claims. A stage
   * that quietly stopped running pass B would write a perfectly good artefact
   * with an empty second group — which is a state the reader is meant to be able
   * to see, so nothing else would look wrong.
   */
  it("buys two searches, not one", async () => {
    await runAndWrite();
    expect(calls).toBe(2);
  });
});

/* ---------------------------------------------------------------- skipping -- */

describe("running the step again", () => {
  it("skips, and spends nothing, when nothing has moved", async () => {
    await runAndWrite();

    calls = 0;
    const done = await stepIsDone(STEPS.debate, ctxFor(), store);
    expect(done, "a debate written a moment ago is not current").toBe(true);
    /* **Zero model spend, measured where a charge can happen.** The failure this
       guards is not a crash: it is up to $0.27 spent again on every job for
       ever, writing a perfectly good artefact each time. */
    expect(calls, "deciding whether to skip must not call the model").toBe(0);
  });

  it("does not skip when the article moves underneath it", async () => {
    /* **The negative control.** Without it the assertion above would pass on a
       `stepIsDone` that answered `true` unconditionally — the same feature
       broken the other way, and much worse: a debate about an article nobody is
       reading any more, served for ever with a green tick over it. */
    await runAndWrite();

    const file = await store.read(SLUG, "hierarchy", "blocks");
    const first = file?.blocks?.[0];
    if (!first) throw new Error("the fixture has no blocks");
    first.text = `${first.text} — and one more sentence the search never saw.`;
    store.plant(SLUG, "hierarchy", "blocks", file);

    expect(await stepIsDone(STEPS.debate, ctxFor(), store)).toBe(false);
  });
});
