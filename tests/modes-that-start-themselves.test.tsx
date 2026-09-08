// @vitest-environment jsdom
/**
 * **Pressing a mode with nothing in it runs it. Arriving at one does not.**
 *
 * The money is in the second sentence. The auto-run fires from the panel's own
 * `status === "none"`, and a panel reaches that state whether the reader pressed
 * a button or pasted a link — so every test here is really about whether a
 * *press* is what happened, and a version that fired on mount would pass the
 * cheerful half of them.
 *
 * ## Why the bar is real and the band is not
 *
 * The press has to be a real `click()` on the real `DockModes` button, because
 * the whole design of the activation token is *which code minted it*. A version
 * that armed inside the query-state setter would be indistinguishable from the
 * right one here — and would fire on Back and Forward, which is the bug.
 * So `Dock` is mounted as itself.
 *
 * The band is a three-line probe rather than `IdeasPanel`, for the reason
 * tests/glossary-one-fetch.test.tsx gives: mounting `Reader` drags in nuqs,
 * Supabase and the layout. What that leaves uncovered — which button in the
 * real panel calls which verb — is tests/step-job-force.test.tsx § what the
 * empty state asks for, which asserts it for all five.
 *
 * ## Under a real `<StrictMode>`
 *
 * Not two hand-written mounts. Mounting twice by hand tests remounting; what
 * has to be survived is React invoking one mount's effects **twice inside one
 * commit**, which is what happens in development and which a check-then-clear
 * token would not survive. GPT Sol, 2026-09-02. Every tree here is under one,
 * so *exactly one POST* is the StrictMode assertion as well as the ordinary one.
 *
 * ## And the GET is let settle before anything is asserted
 *
 * A "no POST on a pasted URL" assertion made before the artefact fetch has
 * resolved and its effects have run is vacuous: it passes because nothing has
 * happened yet, on the broken code as much as on the right code. Every negative
 * case here settles first, and the positive cases beside them are what prove
 * the harness can see a POST at all.
 *
 * docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md § 2e.
 */
import { act, createElement, StrictMode, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mode } from "../src/modes.js";
import type { BlockId, Job } from "../src/types.js";
import { EXPERIMENTAL_ON } from "./helpers/experimental-fixtures.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: NoResizeObserver });
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }),
});

/* ------------------------------------------------------------ the network --

   `apiFetch` rather than `globalThis.fetch`: what is being counted is the
   artefact GET each band makes and the job request each hook asks the queue
   for. Replies can be **held**, so that "the GET has not settled yet" is a
   state a test can put the page in and act from. */

/** Every artefact GET, in order. */
const gets: string[] = [];
/** Every job request the queue was asked for, in order. */
const posts: { slug: string; steps: string[]; force?: string[] }[] = [];

/** What the artefact GET answers: 404 is "nobody has asked for one yet". */
let artefactStatus = 404;
/** Whether the artefact GET rejects outright — a dead network, not a 404. */
let artefactFails = false;
/** Whether replies wait to be released. Off unless a test needs the gap. */
let holdGets = false;
let held: Array<() => void> = [];

function releaseGets(): void {
  const waiting = held;
  held = [];
  for (const go of waiting) go();
}

/** A body the four artefact hooks can read when the answer is 200. */
const READY_BODY = JSON.stringify({
  ideas: { ideas: [], profileHash: null },
  quotes: { quotes: [], profileHash: null },
  stale: false,
  outdated: false,
  profileChanged: false,
});

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (url: string) => {
    gets.push(url);
    if (holdGets) await new Promise<void>((go) => held.push(go));
    if (artefactFails) throw new Error("network");
    return new Response(artefactStatus === 404 ? null : READY_BODY, { status: artefactStatus });
  },
  readJson: async (res: Response) => res.json(),
  fetchOk: async () => new Response(null, { status: 204 }),
  failure: async (res: Response) => new Error(String(res.status)),
}));

vi.mock("../src/web/useProfile.js", () => ({ useHasProfile: () => true }));

/** Whether `run` refuses, so the automatic attempt can be made to fail. */
let postRefuses = false;
let nextJobId = 0;
let jobs: Job[] = [];

vi.mock("../src/web/useJobs.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/web/useJobs.js")>("../src/web/useJobs.js");
  return {
    ...actual,
    /* Posed, because what this file counts is *whether a request was made*.
       The engine's own seeding rule — the other half of stage 2c — needs the
       real one, and has its own file: tests/first-poll-completion.test.tsx. */
    useJobs: () => ({
      jobs,
      loaded: true,
      error: null,
      driverFailures: {},
      lastFailure: () => "The queue said no.",
      run: async (request: { slug: string; steps: string[]; force?: string[] }) => {
        posts.push(request);
        if (postRefuses) return null;
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

const { Dock } = await import("../src/web/Dock.js");
const { useIdeas } = await import("../src/web/useIdeas.js");
const { useQuotes } = await import("../src/web/useQuotes.js");
const { useTimeline } = await import("../src/web/useTimeline.js");
const { useGlossary } = await import("../src/web/useGlossary.js");
const { useDebate } = await import("../src/web/useDebate.js");
const { useSketch } = await import("../src/web/useSketch.js");
const { useIllustrated } = await import("../src/web/useIllustrated.js");
const { diagramInSearch } = await import("../src/web/params.js");
const { resetActivations } = await import("../src/web/activation.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

/**
 * The band, reduced to the three facts this file is about: it calls the real
 * hook, it says whether the run under way started itself, and it offers the
 * verb the empty state's button calls.
 */
function IdeasBand({ slug }: { slug: string }): ReactElement {
  const view = useIdeas(slug);
  return createElement(
    "div",
    { "data-band": "ideas" },
    view.automatic ? "auto" : view.starting ? "starting" : view.status,
    createElement("button", { type: "button", onClick: () => void view.ensure() }, "Find them"),
  );
}

/**
 * **The glossary, and it is the one that mounts with its GET already settled.**
 *
 * Its read lives in `Reader` and runs for every reader of every article
 * (useGlossary.ts § the band: the jobs and the verbs, over a read somebody else
 * owns), so by the time the band opens, `status` is very often already `none` —
 * which means the auto-run effect fires **on mount**, and `<StrictMode>`
 * invokes it twice inside one commit. The other four always start at `loading`
 * and settle on an update, where React invokes an effect once.
 *
 * So this band is the only place in this file where the atomic consumption is
 * actually under test. Replace it with a read followed by a clear and this
 * posts twice.
 */
function GlossaryBand({ slug }: { slug: string }): ReactElement {
  const view = useGlossary(slug, SETTLED_EMPTY_READ);
  return createElement("div", { "data-band": "glossary" }, view.status);
}

/**
 * **Timeline, which is here as a positive control and for nothing else.**
 *
 * Ideas and Quotes carry the awkward sequences; this band asks one question —
 * does pressing Timeline in the real bar start a timeline? — because nothing
 * else in the suite did. Remove `useAutoRun` from `useTimeline`, or turn
 * `timeline`'s `MODE_TARGET` row to `{ kind: "none" }` — which typechecks,
 * because the table asks for a decision and not for a target — and every other
 * test here stays green. GPT Sol, 2026-09-02.
 */
function TimelineBand({ slug }: { slug: string }): ReactElement {
  const view = useTimeline(slug);
  return createElement(
    "div",
    { "data-band": "timeline" },
    view.automatic ? "auto" : view.starting ? "starting" : view.status,
  );
}

function QuotesBand({ slug }: { slug: string }): ReactElement {
  const view = useQuotes(slug, SETTLED_EMPTY_QUOTES_READ);
  return createElement(
    "div",
    { "data-band": "quotes" },
    view.automatic ? "auto" : view.starting ? "starting" : view.status,
  );
}

/**
 * **Debate, and it is the one where being wrong costs the most.**
 *
 * Here for `TimelineBand`'s reason and one of its own. Every other mode in this
 * file spends one model call; Debate spends **two, and both of them go out to
 * the open web** — up to ~$0.27 a run, rising with the length of the article,
 * and it is the newest thing in `MODE_TARGET` (src/web/activation.ts). So the
 * sentence at the top of this file — *arriving at a mode does not run it* — is
 * worth more here than anywhere, and the only thing holding it is one call to
 * `useAutoRun` in useDebate.ts.
 *
 * Remove that call, or turn `debate`'s `MODE_TARGET` row to
 * `{ kind: "none" }`, and every other test in this file stays green.
 */
function DebateBand({ slug }: { slug: string }): ReactElement {
  const view = useDebate(slug);
  return createElement(
    "div",
    { "data-band": "debate" },
    view.automatic ? "auto" : view.starting ? "starting" : view.status,
  );
}

/**
 * **Diagram's two pictures, which are the only place in this file where the mode
 * and the target are not the same word.**
 *
 * Every other band here is opened by a bar button that arms *its own* name.
 * Diagram's button arms whichever picture `?diagram=` says it is about to land
 * on — `sketch` by default, `illustrated` if the reader last chose that — and
 * the reason its `MODE_TARGET` row is `delegated` rather than `fixed` is the
 * sequence in § "spends nothing on a Back step after opening a picture it did
 * not arm" below. Make that row a fixed target — or make its `arm` ignore the
 * press context — and that test is the only thing in the suite that notices.
 */
function SketchBand({ slug }: { slug: string }): ReactElement {
  const view = useSketch(slug, EMPTY_BLOCK_ORDER);
  return createElement(
    "div",
    { "data-band": "sketch" },
    view.automatic ? "auto" : view.starting ? "starting" : view.status,
  );
}

function IllustratedBand({ slug }: { slug: string }): ReactElement {
  const view = useIllustrated(slug, []);
  return createElement(
    "div",
    { "data-band": "illustrated" },
    view.automatic ? "auto" : view.starting ? "starting" : view.status,
  );
}

/** The sketch hook keys its read on the block ids; this file has no article. */
const EMPTY_BLOCK_ORDER: BlockId[] = [];

/**
 * **Which picture the bar thinks it is about to open.** `Dock` reads
 * `location.search` itself, so this is how a test says `?diagram=illustrated`
 * without a router.
 */
function setDiagram(kind: string | null): void {
  const url = new URL(window.location.href);
  if (kind === null) url.searchParams.delete("diagram");
  else url.searchParams.set("diagram", kind);
  window.history.replaceState(null, "", url);
}

/**
 * What `Reader` hands the glossary band: a read that has already come back
 * empty. Posed rather than run — the fetch is `useGlossaryRead`'s, one level up,
 * and this file is about what the band does with the answer.
 */
const SETTLED_EMPTY_READ = {
  status: "none" as const,
  glossary: null,
  stale: false,
  outdated: false,
  profiled: false,
  profileChanged: false,
  error: null,
  reload: async () => {},
  refresh: async () => {},
  clear: () => {},
  patchEntry: () => {},
};

/**
 * The same for the quotes, and posing it is not a convenience here — it is the
 * composition under test.
 *
 * Since 2026-09-08 the opening GET is `useQuotesRead` in `OwnedReader`, which
 * **outlives the band**, while `useAutoRun` stays inside `QuotesBand` and dies
 * with it. That split is the whole reason the fetch was not hoisted wholesale:
 * an activation owner mounted one level up could claim a Quotes press, watch the
 * reader leave the band, and spend it when the GET finally settled — against
 * `activation.ts`'s rule that a press belongs to the band on screen. GPT Sol,
 * reviewing docs/plans/260908i-quotes-marked-in-the-prose-in-every-mode.md.
 *
 * So the band below mounts the band half **only**, over a read that is already
 * settled and empty — which is what the real one sees, and which puts the press
 * and the answer in the same mount, where they belong.
 */
const SETTLED_EMPTY_QUOTES_READ = {
  status: "none" as const,
  quotes: null,
  stale: false,
  outdated: false,
  profiled: false,
  profileChanged: false,
  error: null,
  reload: async () => {},
  refresh: async () => {},
};

/**
 * The reading view, as far as this file is concerned: a mode, the real bar that
 * changes it, and the band that mode opens.
 *
 * `mode` is component state rather than `?mode=` — nuqs is not what is under
 * test, and the distinction the feature turns on is *pressed* versus *arrived*,
 * which a direct call to the setter reproduces exactly. `arrive()` below is the
 * pasted link, the Back step and the link in from the metadata page, all of
 * which reach the panel through that setter and through nothing else.
 */
let arrive: (next: Mode) => void = () => {};

/**
 * **Which picture is on screen**, through the app's own degrade rule rather than
 * a raw read — a link naming a picture that was cut opens the Sketch, and a
 * harness that read the parameter literally would mount no band at all and turn
 * that case into a vacuous pass.
 */
const diagramKind = (): string => diagramInSearch(window.location.search);

function Reading({ slug, start }: { slug: string; start: Mode }): ReactElement {
  const [mode, setMode] = useState<Mode>(start);
  arrive = setMode;
  return createElement(
    "div",
    null,
    mode === "ideas" ? createElement(IdeasBand, { slug }) : null,
    mode === "quotes" ? createElement(QuotesBand, { slug }) : null,
    mode === "timeline" ? createElement(TimelineBand, { slug }) : null,
    mode === "glossary" ? createElement(GlossaryBand, { slug }) : null,
    mode === "debate" ? createElement(DebateBand, { slug }) : null,
    /* **The band Diagram opens is whichever picture the address bar names**, and
       that is the whole point of these two arms — the real `DiagramBand` does
       exactly this with `?diagram=`, and a test that always mounted the Sketch
       could not tell a fixed target from an honest one. */
    mode === "diagram" && diagramKind() === "sketch" ? createElement(SketchBand, { slug }) : null,
    mode === "diagram" && diagramKind() === "illustrated"
      ? createElement(IllustratedBand, { slug })
      : null,
    /* **The switch on**, because modes this file presses — Timeline and
       Remember, and Quotes until it came out on 2026-09-06 — went behind it on
       2026-09-03, and a bar with the default answer draws no Timeline button
       for `press("Timeline")` to find. As a prop that is one literal; had `Dock` subscribed to the store
       itself it would be a posed session and an `/api/reader` body in a file
       whose subject is jobs. Dock.tsx § experimental. */
    createElement(Dock, {
      slug,
      view: "article" as const,
      mode,
      onMode: setMode,
      experimental: EXPERIMENTAL_ON,
    }),
  );
}

let host: HTMLDivElement;
let root: Root;

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Mount the page in the mode a reader would arrive in, and let it settle. */
async function open(start: Mode, slug = "constitution"): Promise<void> {
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(Reading, { slug, start })));
  });
  await settle();
}

/** Re-render at a different slug, without unmounting. */
async function reopen(slug: string, start: Mode): Promise<void> {
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(Reading, { slug, start })));
  });
}

function press(label: string): Promise<void> {
  const found = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!found) throw new Error(`no ${label} button in the bar`);
  return act(async () => {
    found.click();
  });
}

/** The band's own button — the one the empty state draws. */
function pressTheButton(): Promise<void> {
  const found = host.querySelector<HTMLButtonElement>('[data-band="ideas"] button');
  if (!found) throw new Error("the ideas band is not on screen");
  return act(async () => {
    found.click();
  });
}

function bandSays(): string | null {
  return (
    host.querySelector(
      '[data-band="ideas"], [data-band="quotes"], [data-band="timeline"], [data-band="debate"], [data-band="sketch"], [data-band="illustrated"]',
    )?.textContent ?? null
  );
}

/** Artefact GETs only — the bar makes none, but this keeps the count honest. */
function artefactGets(step: string): string[] {
  return gets.filter((u) => u.startsWith(`/api/${step}/`));
}

beforeEach(() => {
  gets.length = 0;
  posts.length = 0;
  jobs = [];
  nextJobId = 0;
  artefactStatus = 404;
  artefactFails = false;
  postRefuses = false;
  holdGets = false;
  held = [];
  resetActivations();
  jobEngine.reset();
  setDiagram(null);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a press", () => {
  it("runs a mode that has never been run, once", async () => {
    await open("plain");
    await press("Ideas");
    await settle();

    /* The GET really happened, so "no POST" elsewhere in this file is a claim
       about a settled panel rather than about an empty one. Two of them, not
       one: `<StrictMode>` double-invokes the load effect, which is exactly the
       thing the token has to survive and the artefact read does not care about. */
    expect(artefactGets("ideas").length).toBeGreaterThan(0);
    /* One, under `<StrictMode>`. Two would be the double-invoked effect. */
    expect(posts).toEqual([{ slug: "constitution", steps: ["ideas"] }]);
  });

  it("says it is starting, instead of offering the button again", async () => {
    await open("plain");
    await press("Ideas");
    await settle();
    /* `automatic` wins the label here — it is the more specific fact, and both
       are true. What matters is that neither is `none`, which is what draws the
       run button. */
    expect(bandSays()).toContain("auto");
  });

  it("does not run it a second time, however many times it is pressed", async () => {
    await open("plain");
    await press("Ideas");
    await settle();
    expect(posts).toHaveLength(1);

    await press("Plain");
    await settle();
    await press("Ideas");
    await settle();
    await press("Ideas");
    await settle();

    expect(posts).toHaveLength(1);
  });

  it("does not run it again after the first attempt was refused", async () => {
    /* The reason the button was chosen over generating on first view, in 2026-08:
       the original version re-fired on every failure and generated, failed and
       generated again for as long as the tab stayed open. One attempt per
       (slug, step) per session is what closes that structurally. */
    postRefuses = true;
    await open("plain");
    await press("Ideas");
    await settle();
    expect(posts).toHaveLength(1);

    await press("Plain");
    await settle();
    await press("Ideas");
    await settle();

    expect(posts).toHaveLength(1);
  });

  it("leaves the button working after a failed attempt", async () => {
    /* The other half of the rule: a person pressing a button is not a loop, and
       the button is the only retry there is. */
    postRefuses = true;
    await open("plain");
    await press("Ideas");
    await settle();
    expect(posts).toHaveLength(1);

    postRefuses = false;
    await pressTheButton();
    await settle();

    expect(posts).toHaveLength(2);
    /* And it is the same request the automatic one made — unforced. A forced
       button here would carry a different `work_key`, which stage 1 would not
       de-duplicate. */
    expect(posts[1]).toEqual(posts[0]);
  });

  it("runs a band whose read had already settled, once and not twice", async () => {
    /* The glossary's read is `Reader`'s and is usually finished before the band
       is opened, so its auto-run effect fires **on mount** — where
       `<StrictMode>` invokes it twice inside one commit. The other four settle
       on an update, where React invokes an effect once, so this is the only
       place in the file where the double invocation actually happens.

       **Two synchronous gates stand in front of it, and this test holds the
       pair rather than either one**: the token is deleted before
       `consumeActivation` returns, and the pair is inserted before
       `beginAutoAttempt` returns. All three mutations were run, 2026-09-02,
       and the honest reading of them is worth writing down —

         - defer only the token delete (`queueMicrotask` around it): **green**;
         - defer only the attempt insert: **green**;
         - defer both: **red**, two `glossary` POSTs.

       So each gate really is sufficient on its own, and no test in this file can
       tell them apart — which is what the comment used to imply and did not
       show. GPT Sol, 2026-09-02. The atomic consumption is held on its own by
       § the press itself at the foot of this file, which asks
       `consumeActivation` directly with no second gate behind it. */
    await open("plain");
    await press("Glossary");
    await settle();

    expect(posts).toEqual([{ slug: "constitution", steps: ["glossary"] }]);
  });

  it("runs the timeline, which nothing else here presses", async () => {
    /* A positive control for the third of the five, held by no other test in
       this file. See TimelineBand above. */
    await open("plain");
    await press("Timeline");
    await settle();

    expect(artefactGets("timeline").length).toBeGreaterThan(0);
    expect(posts).toEqual([{ slug: "constitution", steps: ["timeline"] }]);
  });

  /* The fourth positive control, and the dearest. See DebateBand above. */
  it("runs the debate, which is two web searches and nothing else here presses", async () => {
    await open("plain");
    await press("Debate");
    await settle();

    expect(artefactGets("debate").length).toBeGreaterThan(0);
    expect(posts).toEqual([{ slug: "constitution", steps: ["debate"] }]);
  });

  it("draws the sketch, which is the picture Diagram opens on", async () => {
    /* **The dearest button in the bar that is in front of every reader** —
       ~$0.20 and about two minutes — and the newest thing arming anything
       (2026-09-06). Until that day opening Diagram bought nothing and the empty
       state's Draw button was the only way in; the argument for the change is
       Greg's rule that opening a mode is the reader asking for it.

       Make `MODE_TARGET`'s delegated `diagram` row arm nothing — its `arm` is
       the only thing between this button and the money — and this is the only
       test in the file that goes red. The bar itself no longer names Diagram:
       since 2026-09-06 it makes one `armActivationForMode` call for all
       fourteen and the table executes its own row. */
    await open("plain");
    await press("Diagram");
    await settle();

    expect(artefactGets("sketch").length).toBeGreaterThan(0);
    expect(posts).toEqual([{ slug: "constitution", steps: ["sketch"] }]);
  });

  it("draws the sketch for a link naming a picture that was cut", async () => {
    /* **A link from August saying `?diagram=tree`.** `diagramParam` degrades an
       unrecognised value to the default rather than throwing, which is the rule
       every parser in params.ts follows — so the mode opens the **Sketch**, and
       the bar has to arm the Sketch with it. Reading the raw query value instead
       armed nothing at all: the mode opened on the empty state and the press did
       nothing, which is exactly the extra button-click this change removes.
       GPT Sol, reviewing the built code, 2026-09-06. */
    setDiagram("tree");
    await open("plain");
    await press("Diagram");
    await settle();

    expect(posts).toEqual([{ slug: "constitution", steps: ["sketch"] }]);
  });

  it("runs it when the mode pressed is the one already open", async () => {
    /* A reader who arrived by link, saw the empty state, and pressed the button
       in the bar rather than the one in the band. Without a fresh nonce per
       press, nothing at all happens — the mode did not change, so no effect
       re-runs. */
    await open("ideas");
    expect(posts).toEqual([]);

    await press("Ideas");
    await settle();

    expect(posts).toHaveLength(1);
  });
});

describe("arriving without pressing", () => {
  it("spends nothing on a pasted or bookmarked link", async () => {
    await open("ideas");

    expect(artefactGets("ideas").length).toBeGreaterThan(0);
    expect(bandSays()).toBe("noneFind them");
    expect(posts).toEqual([]);
  });

  it("spends nothing on a Back or Forward step through modes", async () => {
    await open("plain");
    await act(async () => arrive("ideas"));
    await settle();
    await act(async () => arrive("quotes"));
    await settle();
    await act(async () => arrive("ideas"));
    await settle();

    expect(artefactGets("ideas").length).toBeGreaterThan(0);
    expect(posts).toEqual([]);
  });

  it("spends nothing on a Back step after opening a picture it did not arm", async () => {
    /**
     * **The sequence a fixed `diagram: "sketch"` row would have paid for**, and
     * it is the reason `activationForDiagram` is a function. GPT Sol found it
     * in the plan for this change, 2026-09-06:
     *
     *  1. the reader is on Illustrated, so `?diagram=illustrated`;
     *  2. they press Diagram in the bar. A fixed row mints a **sketch** token,
     *     but `IllustratedBand` is what mounts, so nobody claims it;
     *  3. nothing expires an unclaimed token — `claimActivation` retires one only
     *     when a *different* mount asks;
     *  4. a Back step lands on `?diagram=sketch`, the sketch band mounts, finds
     *     the token unowned, claims it, and spends $0.20 on a navigation that
     *     was not a press.
     *
     * The `illustrated` POST in step 2 is the reader's own press and is meant to
     * be there. What must not appear is a **second** POST, for `sketch`, out of
     * step 4.
     */
    setDiagram("illustrated");
    await open("plain");
    await press("Diagram");
    await settle();
    /* **The press itself buys nothing here, and that is not the point of the
       test** — it is `useIllustrated`'s own gate: with no Sketch drawn there is
       nothing to paint, so the token is claimed and *retired* rather than spent
       (useIllustrated.ts § the automatic run waits for the Sketch). What matters
       is that the token was minted for the band that actually mounted, so
       nothing is left lying in the map. */
    expect(artefactGets("illustrated").length).toBeGreaterThan(0);
    expect(posts).toEqual([]);

    /* Leave the mode, then walk back into it on the other picture — both of them
       through `arrive`, which is the setter Back and Forward move and the one
       thing that must never manufacture a press. */
    await act(async () => arrive("plain"));
    await settle();
    setDiagram("sketch");
    await act(async () => arrive("diagram"));
    await settle();

    /* The sketch band really mounted and really asked — so the silence below is
       a settled panel that chose not to spend, not an empty one. */
    expect(artefactGets("sketch").length).toBeGreaterThan(0);
    /* **The assertion.** With a fixed `diagram: "sketch"` row this is one POST:
       the token minted in step 2 was never claimed, and this mount claims it. */
    expect(posts).toEqual([]);
  });

  it("spends nothing when the artefact is already there", async () => {
    artefactStatus = 200;
    await open("plain");
    await press("Ideas");
    await settle();

    expect(bandSays()).toContain("ready");
    expect(posts).toEqual([]);
  });
});

describe("the awkward sequences", () => {
  it("drops a press whose band left the screen, rather than spending it on the way back", async () => {
    /* Ideas, then Quotes before the first GET has settled. The Ideas band is
       gone before it can spend its press, and the press dies with it.
       Rapid Ideas → Quotes therefore runs **only** Quotes, which is the
       non-spending direction of the two.
       src/web/activation.ts § A press belongs to the band that was on screen. */
    holdGets = true;
    await open("plain");
    await press("Ideas");
    await press("Quotes");
    holdGets = false;
    releaseGets();
    await settle();

    expect(posts).toEqual([{ slug: "constitution", steps: ["quotes"] }]);

    /* **The step that used to spend.** Arriving back at Ideas without pressing
       anything — a Back step, a pasted link — inherited the press the first one
       left behind and started a paid job. GPT Sol, 2026-09-02: *"The later Back
       step is still what causes the paid request."* */
    await act(async () => arrive("ideas"));
    await settle();

    expect(posts).toEqual([{ slug: "constitution", steps: ["quotes"] }]);
  });

  it("does not let a later mount inherit a press, even when the reader presses on the way back", async () => {
    /* The same hole, reached the other way round: the press that could be
       inherited is the *earlier* one, and the reader's second press is real. It
       must buy exactly one job, not two. */
    holdGets = true;
    await open("plain");
    await press("Ideas");
    await press("Quotes");
    holdGets = false;
    releaseGets();
    await settle();
    expect(posts).toHaveLength(1);

    await press("Ideas");
    await settle();

    expect(posts).toEqual([
      { slug: "constitution", steps: ["quotes"] },
      { slug: "constitution", steps: ["ideas"] },
    ]);
  });

  it("spends nothing when the article changes under the press", async () => {
    holdGets = true;
    await open("plain");
    await press("Ideas");
    await reopen("elsewhere", "ideas");
    holdGets = false;
    releaseGets();
    await settle();

    /* The token names `constitution`; the panel is now about `elsewhere`. A
       press that navigates to a different article must not arm a panel there. */
    expect(posts).toEqual([]);
  });

  it("does not fire a failed read's press against whatever mounts next", async () => {
    /* An errored GET **keeps** the press — a failed read is not an answer, and
       the reader has to be able to press again (the case above this one). What
       makes that safe is that the press belongs to the mount that was on
       screen: the band the reader comes back to is a new mount, and it retires
       the press rather than spending it. This is the one shape of the bug that
       costs money on a mode nobody pressed, so it is asserted separately from
       the mechanism that prevents it. */
    artefactFails = true;
    await open("plain");
    await press("Ideas");
    await settle();
    expect(posts).toEqual([]);

    artefactFails = false;
    await act(async () => arrive("quotes"));
    await settle();
    await act(async () => arrive("ideas"));
    await settle();

    expect(posts).toEqual([]);
  });

  it("asks again when the reader presses again after a failed read", async () => {
    /* **The reader has to be able to get out of a failed GET**, and pressing
       the mode they are already in is the only control they have: Ideas, Quotes
       and Timeline draw no button at all in their error state.
       The press re-reads rather than spending — a failed GET means we do not
       know whether there is anything there — and the press is still in hand
       when the answer arrives, so an empty answer runs it.
       src/web/useAutoRun.ts § A failed read is not an answer. */
    artefactFails = true;
    await open("plain");
    await press("Ideas");
    await settle();
    expect(posts).toEqual([]);
    expect(bandSays()).toContain("error");
    const readsBefore = artefactGets("ideas").length;

    artefactFails = false;
    await press("Ideas");
    await settle();

    expect(artefactGets("ideas").length).toBeGreaterThan(readsBefore);
    expect(posts).toEqual([{ slug: "constitution", steps: ["ideas"] }]);
  });

  it("makes the same request whether the reader waits or presses the button", async () => {
    /* The overlap that costs money: the automatic run is unforced, and a press
       landing inside the window it is open must be the same key. */
    holdGets = true;
    await open("plain");
    await press("Ideas");
    holdGets = false;
    releaseGets();
    await settle();
    await pressTheButton();
    await settle();

    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
  });
});

/**
 * **The store on its own**, and the only part of this file that does not go
 * through the bar.
 *
 * Everything above is a page, which is the right altitude for a rule about
 * money — but it means both synchronous gates stand behind every assertion, and
 * the mutation notes in § runs a band whose read had already settled say that
 * neither can be seen alone from up there. These four lines can: they ask
 * `consumeActivation` twice with nothing behind it.
 */
describe("the press itself", () => {
  it("is spendable exactly once, by exactly one caller", async () => {
    const { armActivation, claimActivation, consumeActivation, pendingActivation } = await import(
      "../src/web/activation.js"
    );
    const band = Symbol("a band");
    armActivation("constitution", "ideas");
    const nonce = pendingActivation("constitution", "ideas");
    expect(nonce).not.toBeNull();
    expect(claimActivation("constitution", "ideas", nonce as number, band)).toBe(true);

    expect(consumeActivation("constitution", "ideas", nonce as number, band)).toBe(true);
    /* The second invocation of a `<StrictMode>` effect, in one line. A check
       followed by a clear returns true twice here. */
    expect(consumeActivation("constitution", "ideas", nonce as number, band)).toBe(false);
  });

  it("belongs to the band that was on screen, and no later one", async () => {
    const { armActivation, claimActivation, consumeActivation, pendingActivation } = await import(
      "../src/web/activation.js"
    );
    const first = Symbol("the band that was open");
    const second = Symbol("the band the reader came back to");
    armActivation("constitution", "ideas");
    const nonce = pendingActivation("constitution", "ideas") as number;
    expect(claimActivation("constitution", "ideas", nonce, first)).toBe(true);

    /* The Back step. It must not be able to claim it, and it must not be able
       to reach past the claim and spend it either. */
    expect(claimActivation("constitution", "ideas", nonce, second)).toBe(false);
    expect(consumeActivation("constitution", "ideas", nonce, second)).toBe(false);
    /* And it is gone, rather than lying about for the mount after that. */
    expect(pendingActivation("constitution", "ideas")).toBeNull();
  });
});

describe("a different reader in the same tab", () => {
  it("does not inherit the first reader's one attempt", async () => {
    await open("plain");
    await press("Ideas");
    await settle();
    expect(posts).toHaveLength(1);

    /* What `App` does when the signed-in reader changes: the engine tears down,
       and its record of what has already been tried goes with it — one of those
       pairs may name an article the new reader has never seen. */
    jobEngine.reset();
    await press("Plain");
    await settle();
    await press("Ideas");
    await settle();

    expect(posts).toHaveLength(2);
  });
});
