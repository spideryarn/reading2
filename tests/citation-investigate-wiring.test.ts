/**
 * **The composition root reads the real paper, with the real registry** — plan
 * 261001a stage 3. tests/citation-investigate.test.ts drives the press with an
 * injected `readPaper`, and is therefore blind to whether src/store/index.ts
 * wires the real one at all (the memory note *mutate the composition root*:
 * injected fakes cannot see whether the real things are wired together).
 *
 * Two links, each checked by identity rather than by behaviour, so neither can
 * pass by a fake that happens to answer alike:
 *
 * 1. `investigateCitationDeps.readPaper` **is** `readCitedPaper`;
 * 2. `readCitedPaper` calls stage 2's `readPaperEvidence` with stage 1's
 *    `lookupWork` **itself** as the registry — not `null`, not a stand-in.
 *
 * `readPaperEvidence` is mocked so nothing is fetched; importing the store
 * opens no connection.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/paper-evidence.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/paper-evidence.js")>();
  return { ...real, readPaperEvidence: vi.fn(async () => ({ state: "no-address" as const })) };
});

const { lookupWork } = await import("../src/bibliographic.js");
const { readCitedPaper } = await import("../src/citation-investigate.js");
const { readPaperEvidence } = await import("../src/paper-evidence.js");
const { investigateCitationDeps } = await import("../src/store/index.js");

describe("Investigate's composition root (plan 261001a stage 3)", () => {
  it("wires the real paper read into the press", () => {
    expect(investigateCitationDeps.readPaper).toBe(readCitedPaper);
  });

  it("hands the paper read stage 1's lookupWork itself as its registry", async () => {
    const input = {
      work: { title: "T", authors: null, url: "https://arxiv.org/abs/2001.08361", why: "w", passages: [] },
      matchedPageUrl: null,
    };
    await expect(readCitedPaper(input)).resolves.toEqual({ state: "no-address" });
    expect(readPaperEvidence).toHaveBeenCalledTimes(1);
    const [given, deps] = vi.mocked(readPaperEvidence).mock.calls[0] ?? [];
    expect(given).toBe(input);
    expect(deps?.lookup).toBe(lookupWork);
  });
});
