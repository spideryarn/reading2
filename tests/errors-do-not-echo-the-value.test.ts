/**
 * **A refusal does not say the refused value back** — plan 261004h, queue item
 * `qi-ah4chg5w`.
 *
 * Sweep cluster 8 (R11) made `slugPart` and the public `slugFrom` answer
 * `Not a slug` with no value. Four more sentences still wrote what they were
 * handed into the error a client receives. The routes refuse a malformed slug
 * before the slug guards run, so those are a second line; the glossary one is
 * reachable (a page holding a term the glossary has since lost) and is shown
 * to the reader by `useGlossary`.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { pgPublicReader } from "../src/store/public-reader.js";
import { requireSlug } from "../src/store/require-slug.js";
import { makeLookUpTerm } from "../src/term-lookup.js";
import type { GlossaryResponse } from "../src/types.js";

/** Not a slug, and recognisable if it comes back. */
const HOSTILE = "<img src=x onerror=alert(1)>";

function thrownBy(run: () => void): Error {
  try {
    run();
  } catch (err) {
    return err as Error;
  }
  throw new Error("nothing was thrown");
}

describe("a refusal does not echo the value it refused", () => {
  it("requireSlug says only that it is not a slug", () => {
    const err = thrownBy(() => requireSlug(HOSTILE));
    expect(err.message).toBe("Not a slug");
    expect(err).toMatchObject({ status: 400 });
  });

  it("the public reader's own copy says the same", async () => {
    const refusal = pgPublicReader.loadHead(HOSTILE);
    await expect(refusal).rejects.toMatchObject({ message: "Not a slug", status: 400 });
  });

  it("an unknown glossary term is a 404 that names neither the term nor the article", async () => {
    const lookUp = makeLookUpTerm({
      reader: {
        loadArticle: async () => {
          throw new Error("not reached");
        },
        loadGlossary: async () => ({ glossary: { entries: [] }, stale: false, outdated: false }) as unknown as GlossaryResponse,
      },
    } as unknown as Parameters<typeof makeLookUpTerm>[0]);
    const refusal = lookUp("some-article", HOSTILE);
    await expect(refusal).rejects.toMatchObject({ message: "No such glossary term.", status: 404 });
  });

  it("slug allocation running out of tries does not name the slug", async () => {
    /* Twenty collisions on a random short id cannot be staged without rewriting
       the allocator, so the sentence is read where it is written. */
    const source = await readFile(new URL("../src/jobs.ts", import.meta.url), "utf8");
    const sentence = /new Error\(([`"'])Too many articles[^\n]*\1/.exec(source)?.[0];
    expect(sentence, "a literal, with nothing joined on").toBe('new Error("Too many articles already have that name."');
  });
});
