// @vitest-environment jsdom
/**
 * **The Criteria panel, rendered — and the three things about it that no test
 * had ever looked at.**
 *
 * `tests/valence.test.ts` says in its own header that its assertions are *"not
 * tests of a formatter, they are the condition under which
 * `DEFAULT_DIVERGING_SCALE` is allowed to be `rg` at all"*. Every one of them
 * calls `valenceStep`/`valenceWords`/`valenceLabel` directly, so what they
 * actually establish is that four small functions return what they return. The
 * condition red↔green is permitted under — that a reader knows which end is
 * which from something other than the colour — is a property of **this panel**,
 * and until this file nothing rendered it. The demonstration: swapping the two
 * poles in `CriterionResult` compiles clean, leaves tests/valence.test.ts,
 * tests/referee-criteria.test.ts, tests/referee-copy-is-about-the-model.test.ts,
 * tests/referee-placement.test.tsx and tests/colour-scales.test.ts green — 116
 * assertions over the area — and puts *"counts against — the controls settle
 * it"* on a passage the model said was bad. docs/reusable/silent-success.md § "a test derived from the
 * implementation only proves the implementation is itself".
 *
 * So the valence assertions below **never call `valenceLabel`**. Calling it
 * would share the assumption with the code, which is the whole family of bug
 * this repo keeps hitting; the four facts are asserted as independent
 * substrings instead.
 *
 * The other two are the parts of `useCriteria` whose comments say they are
 * load-bearing and which nothing exercised:
 *
 *  - **A delete during a run wins.** The answer landing would otherwise put the
 *    row the referee deleted back on screen, because the `done` frame is the
 *    whole row.
 *  - **Two colour choices for one row are chained**, so the second is not sent
 *    until the first has landed and the server never gets to decide which one
 *    wins; and a failed one does not wedge that row's colour for the rest of
 *    the session. The second of those is belt *and* braces in `recolour`, and
 *    the test says so rather than claiming to pin either strand.
 *
 * ## Why the whole band, rather than the panel on its own
 *
 * `CriteriaView` and `CriterionResult` are not exported — the header of
 * `CriteriaView` says a test could render them "on the day one wants to". This
 * file wants to, and could not, so it mounts the real `CriteriaBand` over a
 * stubbed API instead. That is the stronger version anyway: a component handed
 * its props by hand cannot see the wiring that should have supplied them, which
 * is one of the four ways silent-success.md records a control passing against
 * broken code.
 *
 * Harness: the `vi.mock` of `src/web/lib/api.js` from
 * tests/referee-placement.test.tsx (`readJson` and `failure` deliberately real,
 * because they are the code that decides whether a reply is an answer), and the
 * `NuqsAdapter` from tests/feedback-button-visibility.test.tsx, since the band
 * owns `?crits=`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RefereePoles } from "../src/referee-criteria.js";
import type { SavedCriterion } from "../src/saved-criteria.js";
import type { Block, BlockId } from "../src/types.js";

/** One reply, decided by the test that is running. */
let answer: (url: string, init: RequestInit) => Promise<Response>;

/**
 * `apiFetch` and `fetchOk`, and both are needed: `fetchOk` calls `apiFetch`
 * through the module's own binding, so replacing only the export would leave
 * every DELETE and PATCH in `useCriteria` going to the real one — which reaches
 * for a Supabase session before it makes a request.
 */
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  const apiFetch = (url: string, init: RequestInit = {}) => answer(url, init);
  return {
    ...real,
    apiFetch,
    fetchOk: async (url: string, init: RequestInit = {}) => {
      const r = await apiFetch(url, init);
      if (!r.ok) throw await real.failure(r);
      return r;
    },
  };
});

const { CriteriaBand } = await import("../src/web/CriteriaPanel.js");
const { hitMarks } = await import("../src/web/search-hits.js");
const { directionWords } = await import("../src/web/valence.js");
type Found = import("../src/web/search-hits.js").Found;

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`, so a plausible-looking
   `spya-aaa111` is not one of ours. docs/project/block-ids.md § the alphabet. */
const BLOCK = "spya-k3m9qt" as BlockId;
const SLUG = "a-paper";

/**
 * Poles written the way a real referee's are — a whole clause each, and neither
 * of them the word "good" or "bad". Both matter here: the row has to print the
 * referee's *own* end, and the two are far enough apart that a swap cannot be
 * mistaken for a wording change.
 */
const POLES: RefereePoles = {
  against: "a control is missing",
  favour: "the controls settle it",
};

const BLOCKS: Block[] = [
  {
    id: BLOCK,
    tag: "p",
    kind: "text",
    text: "Thirty-one participants in each arm, with no unexposed comparison group.",
    words: 11,
    html: "<p>Thirty-one participants in each arm, with no unexposed comparison group.</p>",
    gistable: true,
  },
];

function diverging(
  valences: number[],
  over: Partial<SavedCriterion> = {},
  scale: "rg" | "br" = "rg",
): SavedCriterion {
  return {
    id: "spya-crt2aa",
    criterion: "Are the controls adequate for the comparisons being drawn?",
    config: { kind: "diverging", poles: POLES, scale },
    createdAt: "2026-09-01T09:00:00.000Z",
    status: "done",
    results: valences.map((valence, i) => ({
      kind: "diverging" as const,
      blockId: BLOCK,
      quote: `passage ${i}`,
      confidence: 80,
      reasoning: "why it bears on the criterion",
      valence,
    })),
    ...over,
  };
}

/* ------------------------------------------------------------ the harness -- */

let host: HTMLDivElement;
let root: Root;

/**
 * What the band pushed up, and what it asked to be opened — the two things the
 * prose would be drawn from.
 *
 * Collected rather than ignored because the band's whole job is to hand these
 * to `Reader`: the marks are where a valence becomes a colour, and the open key
 * is what rings the phrase a pressed row is about. A test that stubbed them both
 * with `() => {}` could not see either.
 */
let pushed: Found[] = [];
let opened: (string | null)[] = [];

/**
 * **Stable identities, because `mount()` is also how this file re-renders.**
 *
 * `CriteriaBand` keys two effects on these callbacks — the one that pushes the
 * marks up and the one that clears them on unmount — so a fresh arrow function
 * per render makes the cleanup of the second run *after* the first has pushed,
 * and the marks arrive and are wiped in the same frame. That is a fact about
 * this harness and not about the band: `Reader` passes callbacks that keep
 * their identity. Written as consts so a re-render is a re-render.
 */
const collectFound = (next: Found[]): void => {
  pushed = next;
};
const collectOpened = (key: string | null): void => {
  opened.push(key);
};
const noJump = (): void => {};

function mount(): void {
  act(() => {
    root.render(
      createElement(
        NuqsAdapter,
        null,
        createElement(CriteriaBand, {
          slug: SLUG,
          blocks: BLOCKS,
          /* The referee has placed nothing, which is what every case in this
             file is about — the model's own row. tests/referee-gap.test.tsx is
             where the two judgements meet. */
          comments: [],
          onJump: noJump,
          onFound: collectFound,
          openKey: opened.at(-1) ?? null,
          onOpenKey: collectOpened,
        }),
      ),
    );
  });
}

/**
 * Let the `fetch().then()` chains and the `for await` over the stream settle.
 * `setTimeout(0)` rather than a bare `Promise.resolve()`, because the mocked
 * `ReadableStream` and `readEvents`' reader loop each add microtask hops —
 * tests/use-search.test.ts § `flush`.
 */
async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sse(frames: { event: string; data: unknown }[]): Uint8Array {
  return new TextEncoder().encode(
    frames.map((f) => `event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`).join(""),
  );
}

/** A stream this test holds open and feeds a frame at a time. */
function heldStream() {
  let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  return {
    response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    push(frames: { event: string; data: unknown }[]) {
      ctrl?.enqueue(sse(frames));
    },
    end() {
      ctrl?.close();
    },
  };
}

/* ---------------------------------------------------------- reading a row -- */

/** Whitespace flattened, so wrapping cannot matter. */
const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/**
 * **What a sighted reader sees** — the row with the screen-reader sentence
 * taken out.
 *
 * Which is also the check on the sentence being hidden at all: a `className` of
 * `"sr_only"` or `"sr-onlyy"` renders it as ordinary text and nothing errors
 * anywhere, so every fact would then appear *twice* here. The counts below are
 * what notice.
 */
function visible(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const n of clone.querySelectorAll(".sr-only")) n.remove();
  return flat(clone.textContent);
}

/**
 * **What a screen reader is handed** — the row with every `aria-hidden` subtree
 * taken out.
 *
 * jsdom has no accessibility tree, so this is the nearest observable thing to
 * one, and it is an outcome rather than a restatement of the markup: drop
 * `aria-hidden` from the visible spans and the direction, the pole and the
 * number are each announced twice, once loose and once inside the ordered
 * sentence. That is exactly what `CriterionResult`'s comment says the attribute
 * is there to prevent.
 */
function spoken(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const n of clone.querySelectorAll('[aria-hidden="true"]')) n.remove();
  return flat(clone.textContent);
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The valence paragraph of one result row — the four carriers and nothing else. */
function valenceOf(row: Element): Element {
  const p = row.querySelector(".crit-valence");
  if (!p) throw new Error("this row has no valence paragraph");
  return p;
}

function rows(): HTMLElement[] {
  return [...host.querySelectorAll(".crit-result")] as HTMLElement[];
}

function byLabel(label: string): HTMLElement {
  const el = host.querySelector(`[aria-label="${label}"]`);
  if (!el) throw new Error(`no control labelled ${label}`);
  return el as HTMLElement;
}

function click(el: Element): void {
  act(() => {
    (el as HTMLElement).click();
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  answer = () => Promise.resolve(json({ criteria: [] }));
  pushed = [];
  opened = [];
  history.replaceState(null, "", `/read/${SLUG}`);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

/* ------------------------------------------------------------- the words -- */

describe("the condition red ↔ green is permitted under, asserted on the panel", () => {
  /** Load one criterion off the GET and wait for it to reach the screen. */
  async function paint(valences: number[], scale: "rg" | "br" = "rg"): Promise<void> {
    answer = () =>
      Promise.resolve(json({ criteria: [diverging(valences, {}, scale)], sourceHash: "h" }));
    mount();
    await flush();
  }

  it("prints the direction, the referee's own end and the signed number, visibly", async () => {
    await paint([-80]);
    const row = rows()[0];
    expect(row, "no result row reached the screen at all").toBeTruthy();

    const seen = visible(row as Element);
    expect(seen).toContain("counts against");
    expect(seen).toContain(POLES.against);
    expect(seen).toContain("−80");
    /* The other end must not be anywhere near it. This is the assertion that
       swapping the two poles in `CriterionResult` reddens, and it is why the
       poles in this fixture are two long clauses rather than two words. */
    expect(seen).not.toContain(POLES.favour);

    /* Exactly once each: twice means the `.sr-only` sentence is being rendered
       as ordinary text, which is what a mistyped class name does and what
       nothing else here would notice. */
    for (const fact of ["counts against", POLES.against, "−80"]) {
      expect(count(seen, fact), `"${fact}" appears ${count(seen, fact)} times, visibly`).toBe(1);
    }
  });

  it("hands a screen reader the same four facts, rank first, as one sentence", async () => {
    await paint([-40, -80]);
    /* The **second** row, so the rank is a number the fixture does not otherwise
       contain and "rank first" is a real claim rather than a coincidence. */
    const row = rows()[1];
    expect(row).toBeTruthy();

    /* Scoped to the valence paragraph: the rank also leads the jump button
       above it, and reading the whole `<li>` would let that stand in for the
       rank inside the sentence — which is the fact being asserted. */
    const said = spoken(valenceOf(row as Element));
    /* Deliberately not `valenceLabel(2, -80, POLES)`. Asserting the producer
       against itself is the shared assumption this file exists to break. */
    expect(said.startsWith("2.")).toBe(true);
    const at = (s: string) => said.indexOf(s);
    expect(at("counts against")).toBeGreaterThan(0);
    expect(at(POLES.against)).toBeGreaterThan(at("counts against"));
    expect(at("−80")).toBeGreaterThan(at(POLES.against));
    expect(said).not.toContain(POLES.favour);

    /* Once each. Twice means the loose spans have lost their `aria-hidden` and
       the reader hears the pieces and then the sentence — the failure the
       comment on `.crit-valence` names. */
    for (const fact of ["counts against", POLES.against, "−80"]) {
      expect(count(said, fact), `"${fact}" is announced ${count(said, fact)} times`).toBe(1);
    }
  });

  it("names the favourable end, and its sign, on a passage that counts for", async () => {
    await paint([70]);
    const row = rows()[0] as Element;
    expect(visible(row)).toContain("counts for");
    expect(visible(row)).toContain(POLES.favour);
    expect(visible(row)).toContain("+70");
    expect(visible(row)).not.toContain(POLES.against);
    expect(spoken(row)).toContain(POLES.favour);
    expect(spoken(row)).not.toContain(POLES.against);
  });

  it("names neither end at zero rather than rounding it into one", async () => {
    /* Zero is a real answer and the commonest one. A panel that picked a pole
       for it would be making a judgement the model did not. */
    await paint([0]);
    const row = rows()[0] as Element;
    expect(visible(row)).toContain("counts neither way");
    expect(visible(row)).not.toContain(POLES.against);
    expect(visible(row)).not.toContain(POLES.favour);
    expect(spoken(row)).toContain("counts neither way");
    expect(spoken(row)).not.toContain(POLES.against);
    expect(spoken(row)).not.toContain(POLES.favour);
  });

  it("paints the swatch from the mode's ramp, and only ever as a token", async () => {
    /* The fourth carrier, and the one that must not be a colour: a hex value
       here would be beyond the reach of the theme (src/web/valence.ts § "It
       returns a token name, never a colour"). Both ramps, because `--div-rg-0`
       and `--div-0` are opposite ends of opposite scales — a swatch wired to
       the wrong one paints "clearly against" in the favourable colour and
       nothing errors.

       **The ramp comes from `?refscale=` and no longer from the criterion**,
       and this test asserted the opposite until 2026-09-02. It is Sol's finding
       4: the two ramps put red at opposite ends of the truth, so once the prose
       is painted by direction a per-criterion choice means one red underline
       meaning opposite verdicts in one document. The stored `scale` is
       deliberately the *wrong* one in each half below, so a swatch that had gone
       on reading `config.scale` reddens here rather than passing by
       coincidence. */
    await paint([-100, 100], "br");
    const swatches = [...host.querySelectorAll(".crit-valence-swatch")] as HTMLElement[];
    expect(swatches).toHaveLength(2);
    expect(swatches[0]?.style.background).toBe("var(--div-rg-0)");
    expect(swatches[1]?.style.background).toBe("var(--div-rg-8)");

    await act(async () => root.unmount());
    root = createRoot(host);
    history.replaceState(null, "", `/read/${SLUG}?refscale=br`);
    await paint([-100], "rg");
    expect(
      (host.querySelector(".crit-valence-swatch") as HTMLElement | null)?.style.background,
    ).toBe("var(--div-0)");
  });

  it("prints a key saying what a colour in the paper means, in words and glyphs", async () => {
    /* **What pays for painting a judgement in colour**, together with the sign
       after each mark. docs/project/colour-scales.md permits red↔green only
       where the direction is readable from something else, and the prose has no
       words — so the mapping is stated on screen rather than only in a card
       somebody dismissed.

       It has to track the mode's ramp: on `br` the ends are blue and red, and a
       key that said "red counts against" there would be exactly wrong. Asserted
       through the swatch's token rather than through a colour name for that
       reason. */
    await paint([-80]);
    /* Ticked, because the key is about marks that are actually painted. */
    click(host.querySelector(".crit-tick input") as Element);
    await flush();
    const key = host.querySelector(".crit-key");
    expect(key, "no key, so the colours in the paper are unexplained").toBeTruthy();
    const said = flat(key?.textContent);
    expect(said).toContain("−");
    expect(said).toContain("counts against");
    expect(said).toContain("+");
    expect(said).toContain("counts for");
    /* **All four glyphs, not the two ends** — Sol's finding 5. A reader meets
       `·` more often than either pole (zero is the commonest answer) and `±`
       where two marks over one phrase point opposite ways, and neither is
       guessable from a key that shows only red and green. The wording is
       `directionWords`', so the legend and the alt text on the mark itself
       cannot come apart. */
    expect(said).toContain("·");
    expect(said).toContain(directionWords("neither"));
    expect(said).toContain("±");
    expect(said).toContain(directionWords("mixed"));
    const ends = [...(key?.querySelectorAll(".crit-key-swatch") ?? [])] as HTMLElement[];
    /* Three swatches and four entries: `±` deliberately has none, because the
       phrase it describes wears both stripes and there is no one colour for it.
       A fourth swatch appearing here would be the key inventing a colour. */
    expect(ends.map((e) => e.style.background)).toEqual([
      "var(--div-rg-0)",
      "var(--div-rg-4)",
      "var(--div-rg-8)",
    ]);
  });

  it("says what the tick does, because its own label is the criterion", async () => {
    /* Sol's finding 8. Claims labels its identical checkbox in visible text —
       *"Mark these passages in the paper"* — and this one's label is the
       referee's own words, so nothing on screen said that the box is what
       paints the paper.

       **The second sentence changed on 2026-09-02 and the change is the point.**
       It read *"Nothing is marked until you do"*, which the panel then went and
       contradicted on the very next frame: a finished run ticks itself on
       (`onShow`). A copy test is worth writing only if it can catch copy that is
       *false*, so the literal asserted here is the corrected one — Sol's finding
       7 on the built code — and the old sentence is asserted absent, because a
       later edit that put it back would otherwise pass. */
    await paint([-80]);
    const said = flat(host.querySelector(".crit")?.textContent);
    expect(said).toContain("A criterion marks its passages while its tick is on");
    expect(said).toContain("New runs turn it on automatically");
    expect(said).not.toContain("Nothing is marked until you do");
  });
});

/* ------------------------------------------------- pressing a result row -- */

describe("pressing a result rings that phrase rather than washing the block", () => {
  it("opens the key the marks were minted under", async () => {
    /* **The defect this fixes was silent in the worst way**: Referee mode
       hard-coded the open key to `null`, so pressing a criterion result scrolled
       to the *block* and the phrase the row was about was never distinguished —
       while Search's identical rows had the `mark.hit[data-hit-open]` ring all
       along. Nothing errored and the page moved, so it looked like it worked.

       The key is built in two places — `resolveCriterion` mints it, the row
       rebuilds it — so what is asserted is that the two agree. Comparing the
       pressed key against a literal string would let both drift together, so it
       is compared against the marks the band actually pushed up. */
    answer = () => Promise.resolve(json({ criteria: [diverging([-80, 40])], sourceHash: "h" }));
    mount();
    await flush();
    /* Tick it, or nothing is marked at all — which is the rule the sentence
       above the list now states. */
    click(host.querySelector(".crit-tick input") as Element);
    await flush();

    const second = rows()[1];
    expect(second, "no second result row").toBeTruthy();
    click(second!.querySelector(".crit-jump") as Element);
    await flush();

    const key = opened.at(-1);
    expect(key, "pressing a result opened nothing").toBeTruthy();
    expect(pushed.map((f) => f.key)).toContain(key);
    /* And it is the *second* passage's key, not the first — a row that opened
       whichever passage sorted first would pass every assertion above. */
    expect(key).toBe(pushed[1]?.key);
    /* Which is the mark that gets the ring, once `Reader` hands the key back. */
    const marks = hitMarks(pushed, key ?? null, "rg").get(BLOCK) ?? [];
    expect(marks.filter((m) => m.open).map((m) => m.id)).toEqual([key]);
  });

  it("switches an unticked criterion on rather than ringing a mark that is not there", async () => {
    /* **GPT Sol's finding 1, and it is the case a referee actually meets.**
       Marks are default-off, every result row is clickable from the moment the
       run lands, and an unticked criterion contributes no `Found` — so pressing
       a row set an open key that named a mark nothing was drawing. The page
       still scrolled, so it looked like it worked; the band's own "a pressed
       passage that is no longer drawn cannot stay pressed" effect then cleared
       the key on the next frame, and the referee arrived at a paragraph with
       nothing in it distinguished.

       Deliberately **without** ticking first, which is the whole difference
       from the test above — that one ticks, and passed throughout the defect.

       The second `mount()` is not a remount: it re-renders with the open key
       fed back in, which is what `Reader` does and what makes the absence
       effect run at all. Assert before it as well as after, so a fix that
       pushed the marks and then let them be cleared still fails here. */
    answer = () => Promise.resolve(json({ criteria: [diverging([-80, 40])], sourceHash: "h" }));
    mount();
    await flush();
    const tick = host.querySelector(".crit-tick input") as HTMLInputElement;
    expect(tick.checked, "the premise is that nothing is ticked yet").toBe(false);
    expect(pushed, "and that nothing is marked yet").toEqual([]);

    click(rows()[0]?.querySelector(".crit-jump") as Element);
    await flush();

    const key = opened.at(-1);
    expect(key, "pressing a result opened nothing").toBeTruthy();
    expect(tick.checked, "pressing a result left its criterion unticked").toBe(true);
    expect(pushed.map((f) => f.key), "the key names a mark nothing is drawing").toContain(key);

    mount();
    await flush();
    expect(opened.at(-1), "the ring was cleared on the frame after it was set").toBe(key);
    expect(pushed.map((f) => f.key)).toContain(key);
  });

  it("does not turn the marks off when the same row is pressed twice", async () => {
    /* The reason the press calls `onShow` rather than `onToggle`. Pressing a
       passage is not a switch, and a second press that unpainted the paper
       would be the fix above introducing a worse bug than the one it closed. */
    answer = () => Promise.resolve(json({ criteria: [diverging([-80])], sourceHash: "h" }));
    mount();
    await flush();
    const jump = () => click(rows()[0]?.querySelector(".crit-jump") as Element);
    jump();
    await flush();
    jump();
    await flush();
    expect((host.querySelector(".crit-tick input") as HTMLInputElement).checked).toBe(true);
    expect(pushed.length).toBe(1);
  });
});

/* ------------------------------------------------ a delete during a run -- */

describe("a criterion deleted while the model is thinking stays deleted", () => {
  it("does not let the done frame put the row back on screen", async () => {
    /* Seeded as a failed row and restarted with **Try again**, because that is
       the one-click way to get a stream in flight; the form is a longer road to
       the same `send`. */
    const failed = diverging([], {
      status: "error",
      error: "The model did not answer. [ai-empty]",
    });
    const stream = heldStream();
    const posted: string[] = [];
    const deletes: string[] = [];

    answer = (url, init) => {
      const method = (init.method ?? "GET").toUpperCase();
      if (method === "GET") return Promise.resolve(json({ criteria: [failed], sourceHash: "h" }));
      if (method === "POST") {
        posted.push(url);
        return Promise.resolve(stream.response);
      }
      if (method === "DELETE") {
        deletes.push(url);
        return Promise.resolve(json({ ok: true }));
      }
      return Promise.resolve(json({}));
    };

    mount();
    await flush();
    expect(host.textContent).toContain(failed.criterion);

    click(host.querySelector(".crit-retry") as Element);
    await flush();
    expect(posted, "the retry never reached the server, so nothing is in flight").toHaveLength(1);

    stream.push([
      {
        event: "begin",
        data: { ...failed, status: "pending", results: [], sourceHash: "h" },
      },
    ]);
    await flush();
    expect(host.querySelector(".gloss-quiet")?.textContent).toContain("Reading the paper…");

    // The referee gives up on it mid-run.
    click(byLabel("Delete"));
    await flush();
    expect(host.textContent).not.toContain(failed.criterion);
    expect(deletes).toHaveLength(1);

    // …and the answer lands anyway, which is the whole of the race.
    stream.push([
      { event: "done", data: { ...diverging([-80]), id: failed.id, sourceHash: "h" } },
    ]);
    stream.end();
    await flush();

    expect(
      host.textContent,
      "the answer landing put a criterion the referee deleted back on screen",
    ).not.toContain(failed.criterion);
    expect(rows()).toHaveLength(0);
    /* And the DELETE is sent again, because the first one may have run before
       the server finished writing the row it was deleting. */
    expect(deletes.length).toBeGreaterThanOrEqual(2);
  });
});

/* ------------------------------------------------ two colours, one row -- */

describe("two colour choices for one row cannot land out of order", () => {
  /** Open the picker and press the swatch at `position` (1-based, as labelled). */
  function pick(position: number): void {
    /* "Bar and rail colour" rather than "Colour" since 2026-09-02: on a
       for/against row the categorical hue no longer reaches the prose, so the
       control says what it does colour (Sol's finding 6). The rows here are
       `diverging`, so this is the label they carry. */
    click(byLabel("Bar and rail colour"));
    click(byLabel(`Colour ${position}`));
  }

  /** A PATCH whose reply this test decides when — and whether — to give. */
  function harness() {
    const patches: { body: string; settle: (ok: boolean) => void }[] = [];
    answer = (_url, init) => {
      const method = (init.method ?? "GET").toUpperCase();
      if (method === "GET") {
        return Promise.resolve(json({ criteria: [diverging([-80])], sourceHash: "h" }));
      }
      if (method === "PATCH") {
        return new Promise<Response>((resolve) => {
          patches.push({
            body: String(init.body ?? ""),
            settle: (ok) => resolve(ok ? json({ ok: true }) : json({ error: "no" }, 500)),
          });
        });
      }
      return Promise.resolve(json({}));
    };
    return patches;
  }

  it("holds the second one back until the first has landed", async () => {
    const patches = harness();
    mount();
    await flush();

    pick(1);
    await flush();
    expect(patches, "the picker is not wired to anything").toHaveLength(1);

    pick(2);
    await flush();
    expect(
      patches,
      "the second colour was sent before the first had answered, so the server " +
        "decides which one wins",
    ).toHaveLength(1);

    patches[0]?.settle(true);
    await flush();
    expect(patches).toHaveLength(2);

    /* `PALETTE_BY_HUE` is hue order, so position 1 is slot 8 and position 2 is
       slot 1 — the numbers matter only in that they must arrive in the order
       the referee pressed them. */
    expect(JSON.parse(patches[0]?.body ?? "{}").colour).toBe(8);
    expect(JSON.parse(patches[1]?.body ?? "{}").colour).toBe(1);
  });

  it("still sends the next one when the first fails, rather than wedging the row", async () => {
    /* **Two things keep the chain alive and this pins the outcome, not either
       of them**, which has to be said out loud or the next reader takes a green
       run as evidence about the line the comment in `recolour` points at.
       `patch` catches its own failure, so the promise it returns never rejects;
       and the tail is handed `.then(patch, patch)` rather than `.then(patch)`.
       Either alone is enough today, so removing one does **not** redden this —
       take both out and it does. Both are kept because the cost is nothing and
       the failure they prevent is the worst shape there is: one dropped
       connection wedging that row's colour for the rest of the session, with
       nothing on screen saying so, because the hue is applied optimistically
       either way. The same note is on the same test in
       tests/use-search.test.ts, which this is a copy of. */
    const patches = harness();
    mount();
    await flush();

    pick(1);
    await flush();
    expect(patches).toHaveLength(1);

    pick(2);
    await flush();
    patches[0]?.settle(false);
    await flush();

    expect(
      patches,
      "a failed colour PATCH stopped the next one, so this row's colour is stuck",
    ).toHaveLength(2);
    expect(JSON.parse(patches[1]?.body ?? "{}").colour).toBe(1);
  });
});

/* --------------------------------------------- what the paper has done since -- */

describe("a criterion answered about an older paper says so on the row", () => {
  /** The sentence the referee reads. Not imported — `CriteriaPanel` inlines it. */
  const WARNING = "answered about an earlier version of this paper";

  /**
   * Load one criterion off the GET, with whatever the server said about the
   * paper's fingerprint, and wait for the row to reach the screen.
   *
   * `body` is passed through `JSON.stringify` exactly as `send` does on the
   * server, so a `sourceHash: undefined` disappears here the same way it
   * disappears on the wire — which is the whole of the bug this pins.
   */
  async function paint(current: string | undefined, answered: string | undefined): Promise<void> {
    const row = diverging([-80], answered === undefined ? {} : { sourceHash: answered });
    answer = () => Promise.resolve(json({ criteria: [row], sourceHash: current }));
    mount();
    await flush();
    expect(host.textContent, "no criterion reached the screen at all").toContain(row.criterion);
  }

  it("warns when the server checked and could not fingerprint the paper", async () => {
    /* The server answers `sourceHash: undefined` for a paper whose blocks it
       could not read — see the GET in src/routes.ts. That is a real answer, and
       `isStale` says unknown counts as stale from either side. It is also the
       one that vanishes on the wire, so a client reading the key rather than the
       value never sees it and quietly tells the referee nothing has moved. */
    await paint(undefined, "h");
    expect(
      JSON.parse(JSON.stringify({ criteria: [], sourceHash: undefined })),
      "the premise of this test is that JSON drops the key, and it no longer does",
    ).not.toHaveProperty("sourceHash");
    expect(host.textContent, "the referee was told nothing about a paper nobody could read").toContain(
      WARNING,
    );
  });

  it("says nothing when the paper is the one the criterion was answered about", async () => {
    await paint("h", "h");
    expect(host.textContent).not.toContain(WARNING);
  });

  it("warns when the paper has moved since the criterion was answered", async () => {
    await paint("moved", "h");
    expect(host.textContent).toContain(WARNING);
  });

  it("warns about a criterion saved before runs recorded what they answered", async () => {
    /* The other half of `isStale`'s rule: a row with no fingerprint of its own
       cannot be judged against a paper that has one either. */
    await paint("h", undefined);
    expect(host.textContent).toContain(WARNING);
  });
});
