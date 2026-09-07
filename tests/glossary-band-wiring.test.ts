/**
 * **That the reading view is wired the way the hooks assume.**
 *
 * The subjects live in several files since 2026-09-06 — `OwnedReader` is in
 * `src/web/article/`, `Reader` is in `src/web/reader/`, the mode controllers are
 * under `src/web/modes/` — so each assertion reads the file that owns it. **They are
 * read separately and never concatenated**: one synthetic "App" source would
 * make `indexOf` anchors ambiguous again, which is the whole reason `hookBody`
 * exists.
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
 * every open of the panel. docs/plans/260827am-glossary-read-latency.md.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/* Both halves of the reading view left `App.tsx` on 2026-09-06: `OwnedReader`,
   which mounts the owner-only hooks, into `article/`, and `Reader` itself into
   `reader/`. Named separately, and the reads are the guard — a subject that
   moves again fails here rather than in an assertion against the wrong file. */
const articlePage = await readFile(path.join(ROOT, "src/web/article/ArticlePage.tsx"), "utf8");
const reader = await readFile(path.join(ROOT, "src/web/reader/Reader.tsx"), "utf8");
const glossaryMode = await readFile(
  path.join(ROOT, "src/web/modes/glossary/GlossaryMode.tsx"),
  "utf8",
);
const quotesMode = await readFile(path.join(ROOT, "src/web/modes/quotes/QuotesMode.tsx"), "utf8");
const searchMode = await readFile(path.join(ROOT, "src/web/modes/search/SearchMode.tsx"), "utf8");
/* The three passage rules the quotes and search bands used to hold copies of,
   and have called through since 2026-09-06 — so the "before the paint" half of
   the assertions below is now a fact about this file. */
const lifecycle = await readFile(path.join(ROOT, "src/web/passage-lifecycle.ts"), "utf8");
/* And which slot the page is drawing from, which left `Reader` as a pair of
   ternary chains and arrived here as one total function on the same day. */
const passages = await readFile(path.join(ROOT, "src/web/reader/passages.ts"), "utf8");
const glossaryPanel = await readFile(path.join(ROOT, "src/web/GlossaryPanel.tsx"), "utf8");
const quotesPanel = await readFile(path.join(ROOT, "src/web/QuotesPanel.tsx"), "utf8");
const searchPanel = await readFile(path.join(ROOT, "src/web/SearchPanel.tsx"), "utf8");

describe("the reading view's glossary wiring", () => {
  it("reads the glossary exactly once", () => {
    /* `OwnedReader` is the one caller. Counted across the composition as well,
       because "exactly one" is only a fact about the reading view if both of
       the files it is now spread over are asked — a second read added in
       `Reader` would otherwise be invisible. */
    const calls = articlePage.match(/useGlossaryRead\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(reader.match(/useGlossaryRead\(/g) ?? []).toHaveLength(0);
  });

  it("hands that read to the band rather than letting it fetch its own", () => {
    /* `useGlossary` takes the read as its second argument. A call with one
       argument is the old shape, which fetched again. */
    expect(reader).toMatch(/read=\{glossaryRead\}/);
    expect(glossaryMode).not.toMatch(/useGlossary\(slug\)/);
  });

  it("draws the prose's underlines from that same read", () => {
    /* Not from a second list pushed up out of the band, which is what the
       `onEntries` prop did and what needed a `pushed` ref to make safe.

       The `?.` on `glossaryRead` arrived with the capability seam, 2026-08-28:
       the read is mounted by `OwnedReader` and reaches `Reader` through
       `capability`, so it is `null` for a visitor on a shared document, who has
       no glossary and no endpoint to ask for one. Optional in the pattern, not
       required, so this still fails if the local disappears altogether — which
       is the regression it is about. docs/plans/260827ai-public-read-only-access.md. */
    expect(reader).toMatch(/glossaryRead\??\.glossary\?\.entries/);
    /* The prop or the call, not the word — the comment in `GlossaryBand`
       explaining why the prop is gone would otherwise fail this. Both files,
       because the prop would have to come back at both ends of the seam. */
    expect(reader).not.toMatch(/onEntries\s*[=(]/);
    expect(glossaryMode).not.toMatch(/onEntries\s*[=(]/);
  });
});

/**
 * **That the three thresholds are wired the way the shared rule assumes.**
 *
 * Same kind of test as the block above, and the same honest label: it reads
 * source text, so it cannot tell a call in dead code from a call that runs.
 * What it catches is a class of regression no pure-function test can see,
 * because the failure is *where* a call is rather than what it returns — a
 * second filter appearing in a panel, a way back taken off the screen at the
 * moment it is the only way back, a hover card that opens the band on a row the
 * bar is hiding.
 *
 * docs/plans/260903c-threshold-sliders-hide-below-threshold-items.md § Stage 2.
 */
/**
 * One top-level function out of the file that owns it, from its `function` line
 * to whatever comes next at the top level.
 *
 * Not `indexOf("\n}")`: a destructured props object closes on its own line, so
 * that boundary cuts a hook off at its own signature and the assertion under it
 * passes or fails on nothing.
 *
 * **The source is a parameter, and `where` names it**, because a subject that
 * has moved to another file must fail loudly rather than slice from the end of
 * the wrong one and assert about an empty string — docs/reusable/silent-success.md.
 */
function hookBody(source: string, where: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  expect(start, `${name} must exist in ${where} to be checked`).toBeGreaterThan(-1);
  const ends = ["\n/**", "\nfunction ", "\nexport function "]
    .map((mark) => source.indexOf(mark, start + 1))
    .filter((at) => at > -1);
  return source.slice(start, ends.length > 0 ? Math.min(...ends) : source.length);
}

describe("the threshold wiring", () => {
  it("applies the search bar in exactly one place", () => {
    /* The invariant the whole search feature is built around: what goes to the
       panel goes to the prose, so a row in the list and a mark on the paragraph
       can never be a different set. A filter in `SearchPanel` would hide a row
       and leave its wash on the article. */
    expect(searchMode.match(/keepAbove\(/g) ?? []).toHaveLength(1);
    expect(searchPanel).not.toMatch(/keepAbove/);
    /* And nowhere else in the reading view either — the count above is only
       "exactly one" within the file that owns it, so the reader composition has
       to be asked separately. `SearchMode.tsx` moved out of `App.tsx` on
       2026-09-06 and this assertion moved with it; `Reader` followed the same
       day, so the composition to ask is src/web/reader/Reader.tsx. */
    expect(reader).not.toMatch(/keepAbove\(/);
  });

  it("lowers the gate before opening a term the bar is hiding, and only then", () => {
    /* "In the glossary" on a prose hover card is a deliberate request to reveal
       a term, and it used to write `?term=` and nothing else. Once the gate
       hides rather than groups, that opens the band on nothing at all.

       **The order goes in with it**, which is the half a source grep is still
       the only guard for: `gateToReveal` refuses to lower a gate in an order
       that has no slider (`?sort=document&gate=0.80` is dormant, and lowering
       it would set a threshold the reader never saw), and it can only do that
       if the caller hands it the sort. What the function then decides is
       covered properly in tests/glossary.test.ts § the threshold slider. */
    const at = reader.indexOf("const openTermInGlossary");
    /* **The guard, not a convenience.** `indexOf` returns -1 when the subject
       has moved to another file, `slice(-1)` hands back the last character, and
       the two assertions below then pass against nothing at all —
       docs/reusable/silent-success.md. */
    expect(at, "openTermInGlossary must exist in Reader.tsx to be checked").toBeGreaterThan(-1);
    const open = reader.slice(at);
    const body = open.slice(0, open.indexOf("\n  );"));
    expect(body).toMatch(/gateToReveal\(terms, id, sort,/);
    expect(body).toMatch(/setGate\(/);
  });

  it("clears a selection the bar has hidden, in both bands, before the paint", () => {
    /* A hidden row cannot stay the open one: its emphasis in the prose would be
       a claim about the page that the page is not making, and lowering the bar
       later would silently reopen a selection the reader watched disappear.

       **`useLayoutEffect` and not `useEffect`** for the half that reaches the
       prose. Nulling `selected` during render is not enough on its own: the
       value the article draws from is `Reader`'s own state, and a passive
       effect would hand it over only after the browser had had its chance to
       paint the panel without the row. tests/glossary-band-selection.test.tsx
       mounts the band and asserts that ordering for real; this is the cheap
       companion that also covers the quotes band. */
    expect(glossaryMode).toMatch(/hiddenSelection[\s\S]{0,400}setTermId\(null\)/);
    expect(quotesMode).toMatch(/hiddenSelection[\s\S]{0,400}setQuoteId\(null\)/);
    /* Glossary hands its selection up itself: `termSelections` is a different
       currency from `Found[]`, with no push-up to `Reader` and no cleanup, so it
       is deliberately not one of the six producers on the shared hook. */
    expect(
      hookBody(glossaryMode, "GlossaryMode.tsx", "useGlossaryMode"),
      "useGlossaryMode must hand its selection up in a layout effect",
    ).toMatch(/useLayoutEffect\(\(\) => \{\s*onSelected\(/);
    /* Quotes hands its up through `usePassageLifecycle`, which is where the
       layout effect went on 2026-09-06 — so the assertion is in two halves: the
       band delegates, and the hook it delegates to publishes before the paint. */
    expect(
      hookBody(quotesMode, "QuotesMode.tsx", "useQuotesMode"),
      "useQuotesMode must hand its selection up through the shared lifecycle",
    ).toMatch(/usePassageLifecycle\(\{/);
    expect(
      lifecycle,
      "passage-lifecycle.ts must publish in a layout effect, not a passive one",
    ).toMatch(/useLayoutEffect\(\(\) => \{\s*onFound\(found\);/);
  });

  it("keeps the order buttons and the slider on screen when everything is hidden", () => {
    /* The all-hidden state's only way out is the two controls that caused it,
       so neither may be rendered from the filtered list. */
    expect(glossaryPanel).toMatch(/glossary\.entries\.length > 1 && \(\s*<SortBar/);
    expect(glossaryPanel).toMatch(/glossary && order === "prioritised" && \(\s*<GateSlider/);
    expect(quotesPanel).toMatch(/quotes\.quotes\.length > 1 && \(\s*<RankBar/);
    expect(quotesPanel).toMatch(/quotes && rank === "prioritised" && \(\s*<BarSlider/);
    /* Search reaches the same state through an early return, which is the
       precedent the other two follow and has to carry both controls with it. */
    const stranded = searchPanel.slice(searchPanel.indexOf("if (found.length === 0 && all.length"));
    const branch = stranded.slice(0, stranded.indexOf("if (found.length === 0) {"));
    expect(branch).toMatch(/<SortBar/);
    expect(branch).toMatch(/<ConfSlider/);
  });

  it("prints the foot line unconditionally, wherever the slider is", () => {
    /* Present wherever the threshold control is, absent wherever it is not. A
       line that is sometimes missing for a *different* reason teaches the
       reader nothing, so none of the three may be behind a `note &&`. */
    expect(glossaryPanel).toMatch(/<p className="gloss-gate-note">\{note\}<\/p>/);
    expect(quotesPanel).toMatch(/<p className="quotes-bar-note">\{note\}<\/p>/);
    expect(searchPanel).toMatch(/<p className="srch-gate-note">\{note\}<\/p>/);
    for (const panel of [glossaryPanel, quotesPanel, searchPanel]) {
      expect(panel).not.toMatch(/\{note && </);
    }
  });

  it("gives each foot line its own noun and the counts from one pass", () => {
    /* The sentence is shared (threshold.ts § `hiddenNote`) and its wording is
       covered verbatim in tests/threshold.test.ts. What each panel supplies is
       the noun and the two numbers — and the numbers must come out of the same
       result the `N of M` above them does, or the line and the count under the
       reader's hand can disagree. */
    for (const [panel, noun] of [
      [glossaryPanel, "term"],
      [quotesPanel, "quote"],
      [searchPanel, "passage"],
    ] as const) {
      expect(panel).toMatch(new RegExp(`\\{ one: "${noun}", many: "${noun}s" \\}`));
      expect(panel).toMatch(/const \{ visible, hiddenCount \} =/);
      expect(panel).toMatch(/Note\(hiddenCount, /);
    }
  });

  it("says 'showing' rather than 'promoting' on every slider", () => {
    /* An unscored item is shown without being promoted, so the verb would be a
       small lie in the one place this feature has to be honest. */
    for (const panel of [glossaryPanel, quotesPanel, searchPanel]) {
      expect(panel).toMatch(/aria-valuetext=\{`[^`]*showing \$\{count\}/);
    }
  });
});

/**
 * **That the quotes band marks the whole list and not one row.**
 *
 * The same kind of source-level assertion as the two blocks above, and it is
 * here for the same reason: the *behaviour* is covered by
 * tests/quote-marks.test.ts, which knows nothing about `App.tsx` and so cannot
 * tell whether the reading view calls it. This is the cheap companion that
 * catches the regression the feature was built out of — a memo that returned
 * `[]` unless a row was selected, so the mode drew nothing at all on the page
 * until you pressed one.
 *
 * docs/plans/260905g-mark-every-visible-quote-and-make-the-quiz-start-easier.md.
 */
describe("the quotes band's marks", () => {
  it("resolves the list the panel is showing, not the selected row", () => {
    const body = hookBody(quotesMode, "QuotesMode.tsx", "useQuotesMode");
    /* One function answers "what is the panel showing", and the hook and the
       panel both call it. Two expressions computing it is how a row comes to be
       hidden with its wash still on the paragraph. */
    expect(body).toMatch(/markedQuotes\(/);
    expect(body).toMatch(/resolveQuotes\(blocks, /);
    /* The bug itself, named: a guard that made the marks a function of the
       selection. */
    expect(body).not.toMatch(/if \(!selected\) return \[\];/);
  });

  it("hands the pressed quote's key up beside the marks, in one layout effect", () => {
    /* With every quote marked, `mark.hit[data-hit-open]` is the only thing
       saying which one the reader pressed. Pushed in the SAME effect as the
       marks, so a paint can never show the ring on one quote and the wash set
       of another — the ordering argument the ideas and referee bands both make.
       And `Reader` must be holding it, or there is nothing for `hitMarks` to
       compare a key against. */
    /* Two halves since 2026-09-06, because the effect itself moved into
       `usePassageLifecycle`: the band must ask for the `derived` shape, and that
       shape is the one that writes both fields in a single layout effect. A
       band that asked for `keyed` instead would compile, would publish its
       marks, and would never ring anything. */
    expect(hookBody(quotesMode, "QuotesMode.tsx", "useQuotesMode")).toMatch(
      /usePassageLifecycle\(\{ kind: "derived", found, openKey,/,
    );
    expect(lifecycle).toMatch(
      /useLayoutEffect\(\(\) => \{\s*onFound\(found\);\s*if \(kind === "derived"\) onOpenKey\(/,
    );
    /* **`Reader` holds the key, and the marks it goes with come from the same
       slot.** Since 2026-09-06 that is two files: `Reader` puts the pair into
       one `quotes` slot, and `selectPassages` hands that whole slot back for
       quotes mode. It was a pair of ternary chains until then —
       `mode === "quotes" ? quoteOpenKey : …` beside `… ? quoteFound : …` — which
       is the shape this used to match and the shape that let the ring and the
       washes come from different bands. Both halves are asserted, because
       either one alone is satisfied by a `Reader` that builds the slot and a
       selection that never reads it. */
    expect(reader).toMatch(/quotes:\s*\{ found: quoteFound, openKey: quoteOpenKey \}/);
    expect(passages, "selectPassages must answer quotes mode with the quotes slot").toMatch(
      /case "quotes":\s*return slots\.quotes;/,
    );
  });
});

/**
 * **The two things in the band dispatch that only a compiler and a switch can
 * hold, asserted here as well.**
 *
 * The seventeen sibling `&&` expressions at the bottom of `Reader` became one
 * `switch (mode)` on 2026-09-06 (260906c § Stage 4b). The `never` default is
 * what makes a fifteenth mode a compile error instead of an empty band nobody
 * notices, and `plain` and `hierarchy` say `return null` in their own arms
 * rather than falling off the end — both are the point of the change rather
 * than decoration, so both get an assertion.
 *
 * Same honest label as the blocks above: it reads source text. The typecheck is
 * the real gate for the `never`; this is here so somebody running the suite
 * alone still finds out.
 *
 * **What is deliberately not asserted: `key={mode}` on `ConversationBand`.** A
 * first draft of this block did assert it, on the strength of a mutation that
 * deleted the key and left every test green. GPT Sol showed the mutation was
 * green because the key is inert — chat and Remember return different top-level
 * component types, so React discards the outgoing subtree either way — and a
 * guard on a no-op is a guard that will one day be defended for the wrong
 * reason. The history, and the condition that would make the key matter again,
 * are in `reader/Reader.tsx` at the `case "chat"` arm.
 */
describe("the band dispatch", () => {
  it("makes a fifteenth mode a compile error rather than an empty band", () => {
    /* The `never` default, which is the whole reason the seventeen `&&`
       expressions became a switch. Asserted here as well as by the typecheck
       because a `default:` that returned `null` would compile forever and open
       an empty band for the mode nobody wrote a case for. */
    const at = reader.indexOf("function band(): ReactNode");
    expect(at, "band() must exist in Reader.tsx to be checked").toBeGreaterThan(-1);
    const body = reader.slice(at, reader.indexOf("\n  return (", at));
    expect(body).toMatch(/switch \(mode\) \{/);
    expect(body).toMatch(/const unhandled: never = mode;/);
    /* And the two modes that deliberately have no band say so in their own case
       rather than falling through to the default. Each is asked for separately,
       because whether they share one arm or take two is a formatting choice and
       this is not a test about formatting. */
    expect(body).toMatch(/case "plain":[\s\S]{0,60}return null;/);
    expect(body).toMatch(/case "hierarchy":[\s\S]{0,60}return null;/);
  });
});
