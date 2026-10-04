// @vitest-environment jsdom
/**
 * **Simple — Summary's plain-words levels**, on the client
 * (docs/plans/260930i-simple-summaries-eli15-sub-mode.md stage 2, and the
 * slider and levels of
 * docs/plans/261001b-summary-controls-in-one-row-and-two-plain-words-levels-shaped-by-profile-and-goal.md).
 *
 * Three parts:
 *
 *  1. **The view.** The chosen level's paragraphs, each plain text followed by
 *     a `BlockRef` door per id; no description line (7B); *stale* draws the
 *     notice and *outdated* draws nothing; a changed profile offers a rewrite;
 *     a visitor gets the stored paragraphs and no verb, or a line saying none
 *     has been made.
 *  2. **The press.** The real `SummaryControls` — Brief | Fuller | Thread since
 *     2026-10-03 (plan 261003l), a slider before — over the real `useSimple`,
 *     under `<StrictMode>`, counting job requests the way
 *     tests/modes-that-start-themselves.test.tsx does: choosing a length with
 *     nothing stored buys exactly one run; arriving on one (a pasted link, a
 *     Back step, a restore — all the same setter) buys nothing; a second press
 *     recovers from a failed read; and Thread buys nothing here at all.
 *  3. **The band**: the real `SummaryBand` and `VisitorSummaryBand` on an old
 *     outline link, which must land on the default level with no Parts |
 *     Sections anywhere (plan 261001p).
 */
import { act, createElement, type ReactElement, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, BlockId, Job, SimpleLevel, SimpleSummary } from "../src/types.js";
import type { SummaryView } from "../src/web/params.js";
import type { UseSimple } from "../src/web/useSimple.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------ the network -- */

const gets: string[] = [];
const posts: { slug: string; steps: string[]; force?: string[] }[] = [];
/** What `GET /api/simple/:slug` answers: 404 is "nobody has asked for one yet". */
let artefactStatus = 404;
/** Whether the GET rejects outright — a dead network, not a 404. */
let artefactFails = false;

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`. docs/project/block-ids.md. */
const EARLY = "spya-f4q7tw" as BlockId;
const MIDDLE = "spya-k3m9qt" as BlockId;
const LATER = "spya-r8z3nh" as BlockId;

const WHAT = "This essay asks whether a machine could ever be conscious, and says probably not.";
const WHY = "It matters because people are starting to treat chatbots as if they had feelings.";

const BRIEF_TEXT = "A short one: could a machine feel? Probably not.";
const FULLER_TEXT = "The fuller one keeps the essay's own term, the hard problem, and says what it means.";

function artefact(): SimpleSummary {
  return {
    version: "simple/2",
    generator: "test",
    slug: "a-piece",
    sourceHash: "hash",
    generatedAt: "2026-09-30T09:00:00.000Z",
    elapsedMs: 1,
    profileHash: null,
    levels: {
      brief: [
        { text: BRIEF_TEXT, ids: [EARLY] },
        { text: "It matters for chatbots.", ids: [LATER] },
      ],
      simple: [
        { text: WHAT, ids: [EARLY, MIDDLE] },
        { text: WHY, ids: [LATER] },
      ],
      fuller: [
        { text: FULLER_TEXT, ids: [EARLY] },
        { text: WHY, ids: [LATER] },
        { text: "And it says where the argument stops.", ids: [MIDDLE] },
      ],
    },
  };
}

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (url: string) => {
    gets.push(url);
    if (artefactFails) throw new Error("network");
    return artefactStatus === 404
      ? new Response(null, { status: 404 })
      : new Response(JSON.stringify({ simpleSummary: artefact(), stale: false, outdated: false, profileChanged: false }), {
          status: 200,
        });
  },
  readJson: async (res: Response) => res.json(),
  fetchOk: async () => new Response(null, { status: 204 }),
  failure: async (res: Response) => new Error(String(res.status)),
}));

let nextJobId = 0;
const jobs: Job[] = [];
vi.mock("../src/web/useJobs.js", async () => {
  const actual = await vi.importActual<typeof import("../src/web/useJobs.js")>("../src/web/useJobs.js");
  return {
    ...actual,
    useJobs: () => ({
      jobs,
      loaded: true,
      error: null,
      driverFailures: {},
      lastFailure: () => "The queue said no.",
      run: async (request: { slug: string; steps: string[]; force?: string[] }) => {
        posts.push(request);
        nextJobId += 1;
        return { id: `job${nextJobId}` };
      },
      cancel: async () => {},
      add: async () => null,
      addUpload: async () => null,
      retry: async () => {},
      forget: async () => {},
    }),
  };
});

const { SIMPLE_NONE_OWNER, SIMPLE_NONE_VISITOR, SimplePanel } = await import(
  "../src/web/SimplePanel.js"
);
const { BlockLinkProvider } = await import("../src/web/BlockLinkCard.js");
const { SummaryBand, SummaryControls, VisitorSummaryBand } = await import(
  "../src/web/modes/summary/SummaryMode.js"
);
const { useSimple } = await import("../src/web/useSimple.js");
const { resetActivations } = await import("../src/web/activation.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  gets.length = 0;
  posts.length = 0;
  jobs.length = 0;
  nextJobId = 0;
  artefactStatus = 404;
  artefactFails = false;
  resetActivations();
  jobEngine.reset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/* ---------------------------------------------------------------- the view -- */

function owner(over: Partial<UseSimple> = {}): UseSimple {
  return {
    status: "ready",
    simple: artefact(),
    stale: false,
    outdated: false,
    profiled: false,
    profileChanged: false,
    slug: "a-piece",
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    retryRead: async () => {},
    ensure: async () => {},
    regenerate: async () => {},
    refresh: async () => {},
    cancel: () => {},
    ...over,
  };
}

const jumps: BlockId[] = [];

async function draw(
  access: Parameters<typeof SimplePanel>[0]["access"],
  level: SimpleLevel = "simple",
): Promise<void> {
  jumps.length = 0;
  await act(async () =>
    root.render(createElement(SimplePanel, { access, level, onJump: (id: BlockId) => void jumps.push(id) })),
  );
}

const text = (): string => host.textContent ?? "";

/** The foot Greg asked to go (SPIDERYARN-READING2-7B). */
const NO_FOOT = "Written by AI";

describe("the Simple view", () => {
  it("draws each paragraph as text, followed by a door for each of its passages", async () => {
    await draw({ kind: "owner", owner: owner() });
    const paras = [...host.querySelectorAll(".simple-para")];
    expect(paras).toHaveLength(2);
    expect(paras[0]?.querySelector(".simple-text")?.textContent).toBe(WHAT);
    expect(
      [...(paras[0]?.querySelectorAll("a.block-ref") ?? [])].map((a) => a.getAttribute("data-block-link")),
    ).toEqual([EARLY, MIDDLE]);
    expect(
      [...(paras[1]?.querySelectorAll("a.block-ref") ?? [])].map((a) => a.getAttribute("data-block-link")),
    ).toEqual([LATER]);
    expect(text()).not.toContain(NO_FOOT);
  });

  it("jumps to the passage when a door is clicked", async () => {
    await draw({ kind: "owner", owner: owner() });
    const door = host.querySelector<HTMLAnchorElement>(`a.block-ref[data-block-link="${LATER}"]`);
    expect(door).not.toBeNull();
    await act(async () => {
      door?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(jumps).toEqual([LATER]);
  });

  it("opens the cited passage's card from a paragraph door", async () => {
    class FakeResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const index = new Map([
      [EARLY, { text: "The opening evidence for the first paragraph.", section: "The question" }],
      [MIDDLE, { text: "The second piece of evidence.", section: "The question" }],
      [LATER, { text: "The passage explaining why it matters.", section: "Why it matters" }],
    ]);
    await act(async () => {
      root.render(
        <BlockLinkProvider index={index}>
          <SimplePanel
            access={{ kind: "owner", owner: owner() }}
            level="simple"
            onJump={(id: BlockId) => void jumps.push(id)}
          />
        </BlockLinkProvider>,
      );
    });
    const door = host.querySelector<HTMLAnchorElement>(`a.block-ref[data-block-link="${LATER}"]`);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      door?.focus();
      await Promise.resolve();
    });
    const card = document.querySelector<HTMLElement>(".tooltip-anchor");
    expect(card?.textContent).toContain("Why it matters");
    expect(card?.textContent).toContain("The passage explaining why it matters.");
  });

  it("renders a paragraph's markup as the characters, never as HTML", async () => {
    const simple = artefact();
    simple.levels.simple[0] = { text: "<b>bold</b> **stars**", ids: [EARLY] };
    await draw({ kind: "owner", owner: owner({ simple }) });
    expect(host.querySelector(".simple-text b")).toBeNull();
    expect(host.querySelector(".simple-text")?.textContent).toBe("<b>bold</b> **stars**");
  });

  it("says so when the article has moved, and offers to write it again", async () => {
    await draw({ kind: "owner", owner: owner({ stale: true }) });
    expect(host.querySelector(".gloss-stale")).not.toBeNull();
    expect(text()).toContain("older version of the article");
    expect(text()).toContain("Write it again");
    /* The paragraphs are still there under the notice. */
    expect(text()).toContain(WHAT);
  });

  it("draws the level the slider has chosen, and only that one", async () => {
    await draw({ kind: "owner", owner: owner() }, "brief");
    expect(text()).toContain(BRIEF_TEXT);
    expect(text()).not.toContain(WHAT);
    await draw({ kind: "owner", owner: owner() }, "fuller");
    expect(text()).toContain(FULLER_TEXT);
    expect(host.querySelectorAll(".simple-para")).toHaveLength(3);
    await draw({ kind: "visitor", simple: { levels: artefact().levels } }, "brief");
    expect(text()).toContain(BRIEF_TEXT);
  });

  it("offers to write it again once the reader has changed their profile, without a notice line", async () => {
    await draw({ kind: "owner", owner: owner({ profiled: true, profileChanged: true }) });
    expect(text()).toContain("Write it again");
    expect(host.querySelector(".gloss-stale")).toBeNull();
    expect(text()).toContain(WHAT);
    /* And not while the profile is the one they were written for. */
    await draw({ kind: "owner", owner: owner({ profiled: true, profileChanged: false }) });
    expect(text()).not.toContain("Write it again");
  });

  it("says nothing when only the prompt is older", async () => {
    await draw({ kind: "owner", owner: owner({ outdated: true }) });
    expect(host.querySelector(".gloss-stale")).toBeNull();
    expect(text()).not.toContain("older version");
    expect(text()).not.toContain("Write it again");
    expect(text()).toContain(WHAT);
  });

  it("does not say nobody has asked while the press's own run is starting", async () => {
    /* Since 2026-10-02 opening Summary starts the run (plan 261002a), so the
       empty state is drawn with a job under way; "Nobody has asked" beside
       "Writing it in plain words" read as a contradiction in the browser check. */
    await draw({ kind: "owner", owner: owner({ status: "none", simple: null, starting: true }) });
    expect(text()).not.toContain(SIMPLE_NONE_OWNER);
    expect(text()).toContain("Brief and Fuller are written together");
  });

  it("offers to write it when there is none, and shows why a run failed", async () => {
    await draw({ kind: "owner", owner: owner({ status: "none", simple: null }) });
    expect(text()).toContain(SIMPLE_NONE_OWNER);
    expect(text()).toContain("Write it");

    await draw({
      kind: "owner",
      owner: owner({
        status: "none",
        simple: null,
        failed: { message: "The AI service is busy right now.", retryable: true, retry: null },
      }),
    });
    expect(text()).toContain("The AI service is busy right now.");
    /* A way to try again: the run button is still drawn for a retryable failure. */
    expect([...host.querySelectorAll("button")].some((b) => b.textContent?.includes("Write it"))).toBe(
      true,
    );
  });

  it("offers to read again after a failed read, without offering a run", async () => {
    await draw({ kind: "owner", owner: owner({ status: "error", simple: null, error: "Could not reach the server." }) });
    expect(text()).toContain("Could not reach the server.");
    expect(text()).toContain("Try again");
    expect(text()).not.toContain("Write it");
  });

  it("gives a visitor the stored paragraphs and their doors, and nothing to press", async () => {
    await draw({ kind: "visitor", simple: { levels: artefact().levels } });
    expect(host.querySelectorAll(".simple-para")).toHaveLength(2);
    expect(host.querySelectorAll("a.block-ref")).toHaveLength(3);
    expect(text()).not.toContain(NO_FOOT);
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });

  /* ---- sentences that point at their passage (plan 261002e) ---- */

  const ASKS = "This essay asks whether a machine could ever be conscious,";
  const SAYS = "and says probably not.";
  const ASKS_SAYS = `${ASKS} ${SAYS}`;
  /** The first Simple paragraph, cut into a linked and an unlinked sentence. */
  function withSentences(sentences: unknown, text = ASKS_SAYS): SimpleSummary {
    const simple = artefact();
    simple.levels.simple[0] = { text, ids: [EARLY, MIDDLE], sentences };
    return simple;
  }
  const LINKED = [
    { text: ASKS, id: MIDDLE },
    { text: SAYS, id: null },
  ];
  const sentenceLinks = () => [...host.querySelectorAll<HTMLAnchorElement>(".simple-text a.simple-sentence")];
  const doors = (para: Element | undefined) =>
    [...(para?.querySelectorAll(".simple-refs a.block-ref") ?? [])].map((a) => a.getAttribute("data-block-link"));

  it("draws a sentence that names its passage as a block link, the rest as plain words, and the doors after", async () => {
    await draw({ kind: "owner", owner: owner({ simple: withSentences(LINKED) }) });
    const para = host.querySelector(".simple-para");
    /* The same words the guard checked, with one space between the sentences. */
    expect(para?.querySelector(".simple-text")?.textContent).toBe(ASKS_SAYS);
    const links = sentenceLinks();
    expect(links.map((a) => [a.textContent, a.getAttribute("data-block-link")])).toEqual([[ASKS, MIDDLE]]);
    expect(links[0]?.classList.contains("block-ref")).toBe(true);
    /* Its own words name it — not the bare id a chip is read as. */
    expect(links[0]?.hasAttribute("aria-label")).toBe(false);
    expect(doors(para ?? undefined)).toEqual([EARLY, MIDDLE]);
  });

  it("is lit by the band's on-screen rule when its passage is on screen, and not otherwise", async () => {
    const { onScreenLinkCss } = await import("../src/web/on-screen.js");
    host.classList.add("mode-band");
    await draw({ kind: "owner", owner: owner({ simple: withSentences(LINKED) }) });
    const selectorOf = (css: string) => css.slice(0, css.indexOf("{"));
    const [sentence] = sentenceLinks();
    expect(sentence?.matches(selectorOf(onScreenLinkCss([MIDDLE])))).toBe(true);
    expect(sentence?.matches(selectorOf(onScreenLinkCss([EARLY, LATER])))).toBe(false);
  });

  it("jumps to a sentence's passage when the sentence is clicked", async () => {
    await draw({ kind: "owner", owner: owner({ simple: withSentences(LINKED) }) });
    await act(async () => {
      sentenceLinks()[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(jumps).toEqual([MIDDLE]);
  });

  it("opens the sentence's passage, under its section, in the shared card", async () => {
    class FakeResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const index = new Map([
      [EARLY, { text: "The opening evidence.", section: "The question" }],
      [MIDDLE, { text: "Machines and minds, the second passage.", section: "The question" }],
      [LATER, { text: "Why it matters.", section: "Why it matters" }],
    ]);
    await act(async () => {
      root.render(
        <BlockLinkProvider index={index}>
          <SimplePanel
            access={{ kind: "owner", owner: owner({ simple: withSentences(LINKED) }) }}
            level="simple"
            onJump={(id: BlockId) => void jumps.push(id)}
          />
        </BlockLinkProvider>,
      );
    });
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      sentenceLinks()[0]?.focus();
      await Promise.resolve();
    });
    const card = document.querySelector<HTMLElement>(".tooltip-anchor");
    expect(card?.textContent).toContain("The question");
    expect(card?.textContent).toContain("Machines and minds, the second passage.");
  });

  it("gives a visitor the same sentence links", async () => {
    await draw({ kind: "visitor", simple: { levels: withSentences(LINKED).levels } });
    expect(sentenceLinks().map((a) => a.getAttribute("data-block-link"))).toEqual([MIDDLE]);
  });

  /* ---- bold and bullets (plan 261004b) ---- */

  const LEAD = "The essay gives three reasons:";
  const ONE = "Brains are alive and machines are not.";
  const TWO = "A simulation of a storm is not wet.";
  const BULLETS = [
    { text: LEAD, id: null },
    { text: ONE, id: MIDDLE, key: "alive" },
    { text: TWO, id: null },
  ];
  /** The first Simple paragraph as a list: a lead-in and two bullets. */
  function withList(sentences: unknown = BULLETS, list: unknown = true): SimpleSummary {
    const simple = withSentences(sentences, (sentences as { text: string }[]).map((s) => s.text).join(" "));
    simple.levels.simple[0] = { ...simple.levels.simple[0]!, list };
    return simple;
  }

  it("draws a list paragraph as its lead-in and a bullet for each later sentence, still linked", async () => {
    await draw({ kind: "owner", owner: owner({ simple: withList() }) });
    const para = host.querySelector(".simple-para");
    expect(para?.querySelector("p.simple-text")?.textContent).toBe(LEAD);
    const items = [...(para?.querySelectorAll("ul.simple-list > li") ?? [])];
    expect(items.map((li) => li.textContent)).toEqual([ONE, TWO]);
    /* A bullet is one sentence: the linked one is the same block link, so it
       hovers, jumps and lights up with no code of its own. */
    const link = items[0]?.querySelector<HTMLAnchorElement>("a.simple-sentence.block-ref");
    expect(link?.getAttribute("data-block-link")).toBe(MIDDLE);
    expect(link?.textContent).toBe(ONE);
    expect(sentenceLinks()).toContain(link);
    expect(items[1]?.querySelector("a")).toBeNull();
    await act(async () => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(jumps).toEqual([MIDDLE]);
    /* The doors still follow the paragraph. */
    expect(doors(para ?? undefined)).toEqual([EARLY, MIDDLE]);
    /* The other paragraph is untouched. */
    expect(host.querySelectorAll("ul.simple-list")).toHaveLength(1);
  });

  it("draws a list of only two sentences, and one that is not `true`, as prose", async () => {
    await draw({ kind: "owner", owner: owner({ simple: withList(BULLETS.slice(0, 2)) }) });
    expect(host.querySelector("ul.simple-list")).toBeNull();
    expect(host.querySelector(".simple-text")?.textContent).toBe(`${LEAD} ${ONE}`);
    await draw({ kind: "owner", owner: owner({ simple: withList(BULLETS, "true") }) });
    expect(host.querySelector("ul.simple-list")).toBeNull();
  });

  it("draws a sentence's key as one strong, with exactly the key's words, inside the link", async () => {
    const sentences = [
      { text: ASKS, id: MIDDLE, key: "a machine" },
      /* Twice in the sentence: only the first is bold. */
      { text: "Not now and not later.", id: null, key: "not" },
    ];
    const simple = withSentences(sentences, `${ASKS} Not now and not later.`);
    await draw({ kind: "owner", owner: owner({ simple }) });
    const strongs = [...host.querySelectorAll(".simple-text strong")];
    expect(strongs.map((s) => s.textContent)).toEqual(["a machine", "not"]);
    expect(strongs[0]?.closest("a.simple-sentence")?.getAttribute("data-block-link")).toBe(MIDDLE);
    expect(strongs[1]?.closest("a")).toBeNull();
    /* The words are unchanged: bold wraps them, it adds none. */
    expect(host.querySelector(".simple-text")?.textContent).toBe(`${ASKS} Not now and not later.`);
    expect(strongs[1]?.previousSibling?.textContent).toBe("Not now and ");
  });

  it("draws no strong for a key that is not its sentence's words", async () => {
    const sentences = [
      { text: ASKS, id: MIDDLE, key: "a toaster" },
      { text: SAYS, id: null, key: SAYS },
    ];
    await draw({ kind: "owner", owner: owner({ simple: withSentences(sentences) }) });
    expect(host.querySelector(".simple-text strong")).toBeNull();
    expect(host.querySelector(".simple-text")?.textContent).toBe(ASKS_SAYS);
  });

  it("renders markup in a sentence, a bullet or a key as the characters, never as HTML", async () => {
    const sentences = [
      { text: "Three <b>bold</b> things:", id: null },
      { text: "**stars** and <i>tags</i> stay.", id: MIDDLE, key: "<i>tags</i>" },
      { text: "- a dash is a dash.", id: null, key: "**stars**" },
    ];
    await draw({ kind: "owner", owner: owner({ simple: withList(sentences) }) });
    const para = host.querySelector(".simple-para");
    expect(para?.querySelector("b, i, em")).toBeNull();
    expect(para?.querySelector("p.simple-text")?.textContent).toBe("Three <b>bold</b> things:");
    expect([...(para?.querySelectorAll("li") ?? [])].map((li) => li.textContent)).toEqual([
      "**stars** and <i>tags</i> stay.",
      "- a dash is a dash.",
    ]);
    /* The one strong is the valid key, as characters; the other key is not in its sentence. */
    expect([...(para?.querySelectorAll("strong") ?? [])].map((s) => s.textContent)).toEqual(["<i>tags</i>"]);
  });

  it("dismisses a sentence's old passage card when a rewrite changes only its target", async () => {
    class FakeResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    /* The article stays the same; only the rewritten summary's link changes. */
    const index = new Map([
      [EARLY, { text: "The opening evidence.", section: "The question" }],
      [MIDDLE, { text: "Machines and minds, the second passage.", section: "The question" }],
      [LATER, { text: "Why it matters.", section: "Why it matters" }],
    ]);
    const show = async (id: BlockId) => {
      await act(async () => root.render(
        <BlockLinkProvider index={index}>
          <SimplePanel
            access={{ kind: "owner", owner: owner({ simple: withSentences([{ text: ASKS, id }, { text: SAYS, id: null }]) }) }}
            level="simple"
            onJump={(target: BlockId) => void jumps.push(target)}
          />
        </BlockLinkProvider>,
      ));
    };
    const focus = async () => {
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
        sentenceLinks()[0]?.focus();
        await Promise.resolve();
      });
    };
    const cardText = () => document.querySelector(".tooltip-anchor")?.textContent ?? "";
    await show(MIDDLE);
    await focus();
    expect(cardText()).toContain("Machines and minds, the second passage.");
    await show(EARLY);
    expect(sentenceLinks()[0]?.getAttribute("data-block-link")).toBe(EARLY);
    await settle();
    /* The shared card keeps its words through an 80 ms closing animation. */
    await act(async () => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(cardText()).not.toContain("Machines and minds, the second passage.");
    await focus();
    expect(cardText()).toContain("The opening evidence.");
    await act(async () => sentenceLinks()[0]?.click());
    expect(jumps).toEqual([EARLY]);
  });

  it.each([
    ["words that are not the paragraph's text", LINKED, `${ASKS} And something the guard never read.`],
    ["an id the paragraph does not cite", [{ text: ASKS, id: LATER }, { text: SAYS, id: null }], ASKS_SAYS],
    ["an empty list", [], ASKS_SAYS],
    ["a malformed entry", [{ text: ASKS, id: MIDDLE }, SAYS], ASKS_SAYS],
  ])("draws the paragraph exactly as before for %s, owner and visitor alike", async (_label, sentences, words) => {
    for (const access of [
      { kind: "owner" as const, owner: owner({ simple: withSentences(sentences, words) }) },
      { kind: "visitor" as const, simple: { levels: withSentences(sentences, words).levels } },
    ]) {
      await draw(access);
      expect(sentenceLinks()).toHaveLength(0);
      const para = host.querySelector(".simple-para");
      const p = para?.querySelector(".simple-text");
      expect(p?.textContent).toBe(words);
      expect(p?.children).toHaveLength(0);
      expect(doors(para ?? undefined)).toEqual([EARLY, MIDDLE]);
    }
  });

  it("tells a visitor none has been made yet", async () => {
    await draw({ kind: "visitor", simple: null });
    expect(text()).toContain(SIMPLE_NONE_VISITOR);
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });
});

/* --------------------------------------------------------------- the press -- */

/** The owner's band, reduced: the real control and, under it, the real hook. */
function SimpleProbe({ slug }: { slug: string }): ReactElement {
  const view = useSimple(slug);
  return createElement("div", { "data-band": "simple" }, view.starting ? "starting" : view.status);
}

/** The address-bar setter, which is what a pasted link, Back and a restore all reach. */
let arrive: (next: SummaryView) => void = () => {};

function Band({ slug, start }: { slug: string; start: SummaryView }): ReactElement {
  const [view, setView] = useState<SummaryView>(start);
  arrive = setView;
  return createElement(
    "div",
    null,
    createElement(SummaryControls, { slug, value: view, onChange: setView }),
    /* One element for both lengths, so moving between them keeps the hook
       mounted — as `OwnerSimple` does in the real band. Left mounted on Thread
       too, which the real band does not do, **on purpose**: it is what would
       claim and spend a `simple` token if the Thread segment ever armed one. */
    createElement(SimpleProbe, { slug }),
  );
}

async function open(start: SummaryView): Promise<void> {
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(Band, { slug: "a-piece", start })));
  });
  await settle();
}

const segments = (): HTMLButtonElement[] => [
  ...host.querySelectorAll<HTMLButtonElement>('.summ-views [role="radio"]'),
];

/** The view the control says is chosen. */
function chosen(): string | null {
  return segments().find((b) => b.getAttribute("aria-checked") === "true")?.textContent ?? null;
}

/** A press on one segment — the one showing, or another. */
async function pressSegment(label: "Brief" | "Fuller" | "Thread"): Promise<void> {
  const found = segments().find((b) => b.textContent === label);
  if (!found) throw new Error(`no ${label} segment`);
  await act(async () => found.click());
  await settle();
}

const simpleGets = (): string[] => gets.filter((u) => u.startsWith("/api/simple/"));

describe("choosing a plain-words length", () => {
  it("writes them when nothing is stored, once", async () => {
    await open("fuller");
    expect(posts, "arriving buys nothing").toEqual([]);
    await pressSegment("Fuller");
    expect(simpleGets().length).toBeGreaterThan(0);
    expect(posts).toEqual([{ slug: "a-piece", steps: ["simple"] }]);
  });

  it("writes them once when the reader goes straight to Fuller", async () => {
    await open("brief");
    await pressSegment("Fuller");
    expect(chosen()).toBe("Fuller");
    expect(posts).toEqual([{ slug: "a-piece", steps: ["simple"] }]);
  });

  it("does not write them a second time when pressed again, or moved to the other length", async () => {
    await open("fuller");
    await pressSegment("Fuller");
    await pressSegment("Fuller");
    await pressSegment("Brief");
    expect(chosen()).toBe("Brief");
    expect(posts, "one run writes every level").toEqual([{ slug: "a-piece", steps: ["simple"] }]);
  });

  it("writes nothing when they are already stored", async () => {
    artefactStatus = 200;
    await open("brief");
    await pressSegment("Brief");
    await pressSegment("Fuller");
    expect(simpleGets().length).toBeGreaterThan(0);
    expect(posts).toEqual([]);
  });

  it("recovers from a failed read on a second press", async () => {
    artefactFails = true;
    await open("brief");
    await pressSegment("Brief");
    expect(posts, "a failed read is not an answer").toEqual([]);

    artefactFails = false;
    await pressSegment("Brief");
    expect(posts).toEqual([{ slug: "a-piece", steps: ["simple"] }]);
  });

  it("writes nothing for Thread, even with the plain-words hook there to claim a press", async () => {
    /* The thread writes on arrival, from its own band (useTweets.ts); pressing
       its segment must arm nothing for the lengths. */
    await open("brief");
    await pressSegment("Thread");
    expect(chosen()).toBe("Thread");
    expect(simpleGets().length).toBeGreaterThan(0);
    expect(posts).toEqual([]);
  });
});

describe("arriving at a length without choosing it", () => {
  it("spends nothing on a pasted link or a restore", async () => {
    await open("fuller");
    /* The read settled — so "no POST" is about a panel that knows it is empty. */
    expect(simpleGets().length).toBeGreaterThan(0);
    expect(host.querySelector('[data-band="simple"]')?.textContent).toBe("none");
    expect(posts).toEqual([]);
  });

  it("spends nothing on a Back step into it", async () => {
    await open("brief");
    await act(async () => arrive("fuller"));
    await settle();
    expect(simpleGets().length).toBeGreaterThan(0);
    expect(posts).toEqual([]);
  });
});

/* ------------------------------------------------------------ the band -- */

const ARTICLE: Article = {
  highPowerSince: null,
  titleOverridden: false,
  meta: { slug: "a-piece", title: "A piece", url: "https://example.com/piece" },
  blocks: [],
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  tree: { rootId: "spya-root", nodes: {} } as unknown as Article["tree"],
};

/**
 * **Summary is the control and the paragraphs (or the thread), and nothing
 * else** — Greg, 2026-10-01 (spya-b3ggv4): *"let's just get rid of parts and
 * sections"*. docs/plans/261001p-summary-loses-parts-and-sections-a-touch-wider.md.
 *
 * The real bands, under the real address bar, on the address an old link
 * carries: `?summary=gists&deep=2` was the outline at Sections. It must land
 * on the default plain-words length, with no Parts | Sections pair and no
 * outline anywhere in the band, for the owner and for a visitor.
 */
describe("Summary's band, arriving on an old link", () => {
  const OLD_LINK = "/read/a-piece?mode=summary&summary=gists&deep=2";

  const visitorBand = (): ReactElement =>
    createElement(VisitorSummaryBand, {
      slug: "a-piece",
      simple: { levels: artefact().levels },
      thread: undefined,
      article: ARTICLE,
      onJump: () => {},
    });

  async function band(which: "owner" | "visitor"): Promise<void> {
    history.replaceState(null, "", OLD_LINK);
    const { NuqsAdapter } = await import("nuqs/adapters/react");
    const inner =
      which === "owner"
        ? createElement(SummaryBand, { slug: "a-piece", article: ARTICLE, onJump: () => {} })
        : visitorBand();
    await act(async () => {
      root.render(createElement(NuqsAdapter, null, inner));
    });
    await settle();
  }

  function noOutline(): void {
    const labels = [...host.querySelectorAll("button, legend")].map((el) => el.textContent?.trim());
    expect(labels, "no Parts | Sections pair").not.toContain("Parts");
    expect(labels).not.toContain("Sections");
    expect(labels, "no outline group").not.toContain("Outline");
    expect(host.querySelector(".summ-pill"), "no pills").toBeNull();
    expect(host.querySelector(".summ-list"), "no gist outline").toBeNull();
    expect(host.querySelectorAll(".mode-band.summ"), "one Summary band").toHaveLength(1);
    expect(host.querySelectorAll(".summ-controls"), "one row of controls").toHaveLength(1);
  }

  it("draws the owner the default plain-words length, not the outline", async () => {
    await band("owner");
    noOutline();
    /* Brief, the default since 8N (plan 261002c). */
    expect(chosen()).toBe("Brief");
    /* The plain-words body, at its empty state — the GET answered 404. */
    expect(text()).toContain(SIMPLE_NONE_OWNER);
    expect(posts, "arriving on a link spends nothing").toEqual([]);
  });

  it("draws a visitor the stored paragraphs at the default length", async () => {
    await band("visitor");
    noOutline();
    expect(chosen()).toBe("Brief");
    expect(text()).toContain(BRIEF_TEXT);
    expect(text()).not.toContain(WHAT);
    expect(gets, "a visitor's band reads nothing").toEqual([]);
  });

  /* Greg, 2026-10-01 (8N, spya-zw479b): "In summary mode, default to the
     brief summary when it opens for the first time." No `?summary=` selects
     that default; an explicit Fuller is remembered in the address. */
  it("opens on Brief when the address names no view, and on Fuller only when it says so", async () => {
    const { NuqsAdapter } = await import("nuqs/adapters/react");
    history.replaceState(null, "", "/read/a-piece?mode=summary");
    await act(async () => {
      root.render(createElement(NuqsAdapter, null, visitorBand()));
    });
    await settle();
    expect(chosen()).toBe("Brief");
    expect(text()).toContain(BRIEF_TEXT);
    await act(async () => {
      root.unmount();
    });
    root = createRoot(host);
    history.replaceState(null, "", "/read/a-piece?mode=summary&summary=fuller");
    await act(async () => {
      root.render(createElement(NuqsAdapter, null, visitorBand()));
    });
    await settle();
    expect(chosen()).toBe("Fuller");
    expect(text()).toContain(FULLER_TEXT);
    /* Back to Brief, the default: nuqs drops it from the address (plan, Sol P2). */
    await pressSegment("Brief");
    for (let i = 0; i < 50 && new URLSearchParams(location.search).has("summary"); i += 1) {
      await act(async () => {
        await new Promise((go) => setTimeout(go, 10));
      });
    }
    expect(chosen()).toBe("Brief");
    expect(new URLSearchParams(location.search).has("summary")).toBe(false);
  });

  /* The Simple level was a view until 2026-10-03. It is still written and
     stored (plan 261003l § 5) and no longer shown, so a link that names it
     degrades to the default like any unknown value. */
  it("reads an old ?summary=simple as Brief, and never draws the Simple level", async () => {
    const { NuqsAdapter } = await import("nuqs/adapters/react");
    history.replaceState(null, "", "/read/a-piece?mode=summary&summary=simple");
    await act(async () => {
      root.render(createElement(NuqsAdapter, null, visitorBand()));
    });
    await settle();
    expect(chosen()).toBe("Brief");
    expect(text()).toContain(BRIEF_TEXT);
    expect(text()).not.toContain(WHAT);
  });

  it("names its three choices in words, in one row", async () => {
    await band("owner");
    expect(host.querySelector("input[type=range]"), "the slider is gone").toBeNull();
    expect(host.querySelector(".summ-controls")?.textContent).toBe("BriefFullerThread");
  });
});
