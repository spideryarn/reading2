/**
 * **The byline eval as a gate** — evals/pdf/bylines/cases.json through
 * `verifyAuthors`, plan 261001l. Free and deterministic: the model's answers
 * are fixed in the cases, so this measures the check, not the model.
 *
 * The number that must not move is **silent drops**: of the answers derived to
 * leave a printed author out, how many the check took. Measured when the eval
 * was written: 60 of 738 on the check as it was, 0 after. The positives are
 * pinned per case too, so a change that takes more or fewer real bylines shows
 * up here by name, and `npx tsx evals/pdf/bylines.mts --old=…` says why.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type BylineCase, droppedAnswers, scoreCase } from "../evals/pdf/bylines-score.js";
import { verifyAuthors } from "../src/pdf-authors.js";

const cases = JSON.parse(readFileSync(new URL("../evals/pdf/bylines/cases.json", import.meta.url), "utf8")) as BylineCase[];

/**
 * What each real byline gets today. `list` is the clean, linked author list;
 * `refused` leaves the byline as printed. A refusal here is safe, not right —
 * plan 261001l § Future says which shapes are still to do.
 */
const EXPECTED: Record<string, "list" | "names" | "refused"> = {
  "attention-stream": "list",
  "attention-rows": "list",
  "ilyas-stream": "refused",
  "ilyas-rows": "refused",
  "rnd-rows": "refused",
  "karras-stream": "refused",
  "karras-rows": "list",
  "lu-shared-geometry": "list",
  "pytorch-21-authors": "list",
  ddpm: "list",
  "mikolov-word2vec": "list",
  "christiano-missing-institution": "list",
  "bert-braces": "list",
  "resnet-braces": "list",
  "dqn-braces": "list",
  "cot-braces": "refused",
  "dpo-symbol-markers": "refused",
  "vit-equal-contribution": "refused",
  "flashattention-letter-symbols": "list",
  "lora-asterisk": "refused",
  "vgg-ampersand": "list",
  "neural-ode": "list",
  "instructgpt-20-authors": "list",
  "frontiers-numeric-and": "list",
  "arnn-letter-markers": "list",
  "copernicus-superscript": "list",
  "acl-affiliation-in-byline": "refused",
  "nakamura-jneurosci": "list",
  "wen-jneurosci-star": "list",
  "kim-jneurosci-multi-marker": "list",
  "ben-yakov-orcid": "list",
  "williams-orcid-3": "list",
  "boulet-elsevier-letters": "names",
  "michel-letters-multi": "refused",
  "yu-magri-letters": "list",
  "bing-letters": "list",
  "koide-majima-dagger": "list",
  "pourkamali-inline-institution": "refused",
  "pierro-grouped": "refused",
};

describe("the byline eval (evals/pdf/bylines/)", () => {
  const scores = cases.map((c) => scoreCase(verifyAuthors, c));

  it("never takes an answer that leaves a printed author out", () => {
    const drops = scores.flatMap((s) => s.silentDrops.map((d) => `${s.id}: ${d}`));
    expect(drops).toEqual([]);
    /* The negatives exist: a scorer that derived nothing would pass the line above. */
    expect(scores.reduce((n, s) => n + s.dropsTried, 0)).toBeGreaterThan(500);
  });

  it("gets each real byline the outcome it is pinned to", () => {
    expect(Object.fromEntries(scores.map((s) => [s.id, s.positive]))).toEqual(EXPECTED);
  });

  it("derives the passed-off negative — the dropped author's words handed to the one before", () => {
    const derived = droppedAnswers([
      { name: "Alice Adams", affiliations: ["Acme"] },
      { name: "Bob Brown", affiliations: ["Beta"] },
    ]);
    expect(derived.map((d) => d.how)).toContain("drop 2, passed off as 1's affiliation");
    expect(derived.find((d) => d.how === "drop 2, passed off as 1's affiliation")?.answer).toEqual([
      { name: "Alice Adams", affiliations: ["Acme", "Bob Brown Beta"] },
    ]);
  });
});
