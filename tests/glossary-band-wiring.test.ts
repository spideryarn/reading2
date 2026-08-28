/**
 * **That `App.tsx` is wired the way the hooks assume.**
 *
 * `tests/glossary-one-fetch.test.tsx` proves the hooks share one read. It
 * cannot prove that the reading view *uses* them that way, because it stands in
 * for `Reader` with a component of its own — mounting the real one drags in
 * nuqs, Supabase and the layout. So the duplicate fetch could come back by
 * calling `useGlossaryRead` twice, or by giving `GlossaryBand` a second read,
 * and every test in that file would stay green. GPT Sol's fifth finding on the
 * built code, and its suggested fix: a source-level assertion, labelled
 * honestly as one.
 *
 * **This is a wiring regression test, and it is not a strong one.** It reads
 * text; it cannot tell a call in dead code from a call that runs. What it does
 * catch is the specific regression that made this change necessary — two
 * readers of one endpoint — which was invisible for weeks and cost a second on
 * every open of the panel. docs/plans/glossary-read-latency.md.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(path.join(ROOT, "src/web/App.tsx"), "utf8");

describe("the reading view's glossary wiring", () => {
  it("reads the glossary exactly once", () => {
    const calls = app.match(/useGlossaryRead\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it("hands that read to the band rather than letting it fetch its own", () => {
    /* `useGlossary` takes the read as its second argument. A call with one
       argument is the old shape, which fetched again. */
    expect(app).toMatch(/read=\{glossaryRead\}/);
    expect(app).not.toMatch(/useGlossary\(slug\)/);
  });

  it("draws the prose's underlines from that same read", () => {
    /* Not from a second list pushed up out of the band, which is what the
       `onEntries` prop did and what needed a `pushed` ref to make safe.

       The `?.` on `glossaryRead` arrived with the capability seam, 2026-08-28:
       the read is mounted by `OwnedReader` and reaches `Reader` through
       `capability`, so it is `null` for a visitor on a shared document, who has
       no glossary and no endpoint to ask for one. Optional in the pattern, not
       required, so this still fails if the local disappears altogether — which
       is the regression it is about. docs/plans/public-read-only-access.md. */
    expect(app).toMatch(/glossaryRead\??\.glossary\?\.entries/);
    /* The prop or the call, not the word — the comment in `GlossaryBand`
       explaining why the prop is gone would otherwise fail this. */
    expect(app).not.toMatch(/onEntries\s*[=(]/);
  });
});
