// @vitest-environment jsdom
/**
 * **The fifth diagram chip, and the four things about it that fail silently.**
 *
 * Every one of these is a state that looks fine from the outside if it is
 * wrong: a broken-image glyph that is actually a 401, a chip that spends $0.40
 * on being arrived at, a row that jumps to a block the quote is not in, a plate
 * the run never painted showing as a gap. docs/project/diagram.md § Illustrated.
 *
 * The first case is the one to read. **`<img src="/api/illustrated/…">` 401s**,
 * because authentication here is an `Authorization: Bearer` header and an
 * `<img>` sends no headers — and what the reader sees is a broken image with
 * nothing in the console, which reads exactly like a CSS mistake. It was
 * written red first against a `Plate` that did use a bare `src`, and both of
 * its assertions failed: no request was made for the bytes at all, and the
 * `src` was an API path rather than a blob URL.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId, Tree } from "../src/types.js";
import { DiagramPanel } from "../src/web/DiagramPanel.js";
import { IllustratedView } from "../src/web/IllustratedView.js";
import { pendingActivation, resetActivations } from "../src/web/activation.js";
import { jobEngine } from "../src/web/jobEngine.js";
import { buildSummaryTree, type SummaryNode } from "../src/web/tree.js";
import { visitorGap } from "../src/web/visitor.js";

/** A 64-character hex string, because the plate route's pattern demands one. */
const HASH = "a".repeat(64);

const PROSE =
  "The mind is not a machine that can be taken apart and reassembled at will.";
/* Verbatim, contiguous, seven words and thirty-seven characters — over the
   four-word, twenty-character floor `readStoredIllustrated` enforces, and inside
   the block it names, which is the check that stops a row jumping somewhere the
   quote is not. */
const QUOTE = "not a machine that can be taken apart";

const BLOCKS: Block[] = [
  { id: "spya-b0" as BlockId, tag: "p", kind: "text", text: PROSE, words: 14, html: `<p>${PROSE}</p>`, gistable: true },
  { id: "spya-b1" as BlockId, tag: "p", kind: "text", text: "A second paragraph, about something else entirely.", words: 7, html: "<p>second</p>", gistable: true },
];

/** Two plates: one painted, one the run could not paint. Both real states. */
const ILLUSTRATED = {
  version: "illustrated/1",
  generator: "a-model",
  illustrator: "openai/gpt-image-2",
  style: "An illuminated manuscript page, because the essay is about souls.",
  profileHash: null,
  plates: [
    {
      sceneId: "overview",
      title: "The whole argument",
      prompt: "A vellum page in gouache and gold leaf, with roundels linked by vine scroll.",
      /* **One good vignette and two the browser must refuse**, because a
         fixture where everything is valid cannot tell a panel that validates on
         arrival from one that renders whatever came down the wire. Block ids
         move when an article is re-extracted, and a quote can be a real
         sentence of the article taken from the block next door — both of those
         are rows that would jump somewhere not containing what the reader just
         read, which is the one thing this list may never do. */
      vignettes: [
        {
          block: "spya-b0",
          quote: QUOTE,
          depicts: "A clockwork skull being pulled apart on a workbench",
          /* The caption that is lettered on the plate itself, so the reader can
             match a title they read off a vignette to the row it belongs to. */
          title: "CLOCKWORK SKULL",
        },
        {
          block: "spya-gone",
          quote: QUOTE,
          depicts: "A hand pointing at a paragraph this article no longer has",
        },
        {
          /* Verbatim and contiguous — but from `spya-b0`, while claiming `spya-b1`. */
          block: "spya-b1",
          quote: QUOTE,
          depicts: "A quote lifted from the block next door",
        },
      ],
      image: { sha256: HASH, ext: "jpeg", bytes: 73_000, width: 1024, height: 1536 },
    },
    {
      sceneId: "detail",
      title: "The first support",
      prompt: "The same hand, one movement of the argument.",
      vignettes: [],
      failed: "the image model refused this plate",
    },
    /* **Neither picture nor failure**, which is the arm of the union it is
       easiest to forget: `withStoredOutcome` (src/illustrated-plate.ts) returns
       it for a stored plate whose `image` record does not parse, with a fault
       beside it. An older schema and a hand-edited column reach it too. */
    {
      sceneId: "aside",
      title: "An aside",
      prompt: "A marginal drollery.",
      vignettes: [
        { block: "spya-b0", quote: QUOTE, depicts: "A hare blowing a trumpet in the margin" },
      ],
      image: { sha256: "not-a-hash", ext: "jpeg", bytes: 0, width: 0, height: 0 },
    },
  ],
};

let host: HTMLDivElement;
let root: Root;
/** Every request `fetch` was given, as `METHOD url`, in order. */
let asked: string[] = [];
/**
 * The body of every `POST /api/jobs`, parsed.
 *
 * The URL alone cannot answer the question the one-press chain raises: *which
 * steps did that press buy, and did it force any of them?* A test that counted
 * `POST /api/jobs` would pass just as happily on a request naming `sketch`
 * alone, on one naming both forced, and on the right one.
 */
let posted: { slug?: string; steps?: string[]; force?: string[] }[] = [];

interface Serving {
  /** 404 the artefact, which is the ordinary case for an unpainted article. */
  noArtefact?: boolean;
  /** What `GET /api/sketch/:slug` answers, or 404 when absent. */
  sketch?: { stale: boolean; profileChanged: boolean } | null;
  /** What the plate's bytes route answers. 200 unless a test says otherwise. */
  plateStatus?: number;
  /** Hold `GET /api/sketch/:slug` open, so `checking` can be observed. */
  hangSketch?: boolean;
  /** What `GET /api/jobs` answers. Empty unless a test puts a run in flight. */
  jobs?: unknown[];
}

/**
 * Write the request down before answering it.
 *
 * Its own function rather than four lines inside the stub, so that the stub
 * stays about *what the server says* — it is already at biome's cognitive
 * complexity ceiling, and the recording has nothing to do with the routing.
 */
function record(method: string, u: string, init?: RequestInit): void {
  /* The method as well as the URL, because the assertion that matters most here
     is that nothing was **posted** — the job list is polled on a GET by a
     tab-level engine this component does not control, so counting requests to
     `/api/jobs` would prove nothing either way. */
  asked.push(`${method} ${u}`);
  if (method === "POST" && /\/api\/jobs$/.test(u) && typeof init?.body === "string") {
    posted.push(JSON.parse(init.body));
  }
}

function serving(opts: Serving = {}) {
  asked = [];
  posted = [];
  const jobs = opts.jobs ?? [];
  vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    record(method, u, init);
    if (/\/api\/illustrated\/[^/]+\/[0-9a-f]{64}\.jpeg$/.test(u)) {
      /* **A refusal still has a body**, which is the whole hazard: an error
         page makes a perfectly good Blob, so a component that skipped `res.ok`
         would show it as a picture. */
      if (opts.plateStatus && opts.plateStatus !== 200) {
        return new Response(JSON.stringify({ error: "no" }), { status: opts.plateStatus });
      }
      /* Real bytes rather than an empty body: `res.blob()` is what the
         component calls, and a `Response` with no body still produces a Blob,
         so this is about the test being honest rather than about it passing. */
      return new Response(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" }), {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      });
    }
    if (u.includes("/api/illustrated/")) {
      if (opts.noArtefact) return new Response("{}", { status: 404 });
      return new Response(
        JSON.stringify({ illustrated: ILLUSTRATED, stale: false, outdated: false, profileChanged: false }),
        { status: 200 },
      );
    }
    if (u.includes("/api/sketch/")) {
      /* Never settles, so the panel stays in `checking` — the window in which
         an automatic run must not spend anything. */
      if (opts.hangSketch) return new Promise<Response>(() => {});
      if (!opts.sketch) return new Response("{}", { status: 404 });
      return new Response(
        JSON.stringify({ sketch: { version: 1, scenes: [] }, outdated: false, ...opts.sketch }),
        { status: 200 },
      );
    }
    /* `done`, or the job engine's drive loop never returns — see
       tests/sketch-view-drawing.test.tsx for that trap in full. */
    if (u.includes("/advance")) {
      return new Response(JSON.stringify({ job: null, ran: null, busy: false, done: true }), { status: 200 });
    }
    /* The list the engine polls, and — unchanged — the body a POST gets back.
       Nothing in this file reads a created job back out of the POST, and the
       tests that watch a run in flight seed `jobs` instead, which is also what
       a job started in another tab looks like. */
    if (u.includes("/api/jobs")) return new Response(JSON.stringify({ jobs }), { status: 200 });
    return new Response("{}", { status: 200 });
  });
  jobEngine.start("reader-1");
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  /* jsdom implements neither, and the whole point of this component is that it
     makes an object URL rather than pointing an `<img>` at our API. */
  URL.createObjectURL = vi.fn(() => "blob:spideryarn/plate-1");
  URL.revokeObjectURL = vi.fn();
  jobEngine.reset();
  resetActivations();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* **Five flushes, and the number is not superstition.** `apiFetch` asks for a
   token before it sends, so the artefact, the plate's bytes and the job list
   each land on a later microtask; the plate hook then clears its previous
   answer in an effect before the fetch even starts, which is another commit
   again. Asserting too early sees a panel that has only half arrived — which is
   also exactly what a genuinely broken fetch looks like. */
async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function mount(onJump: (id: BlockId) => void = () => {}) {
  await act(async () => {
    root.render(<IllustratedView slug="s" blocks={BLOCKS} onJump={onJump} />);
    await new Promise((r) => setTimeout(r, 0));
  });
  await settle();
}

describe("the plate's bytes", () => {
  /**
   * **Written red first.** Against a `Plate` that rendered
   * `<img src={"/api/illustrated/s/" + hash + ".jpeg"}>` both of these failed:
   * `asked` held no request for the bytes, because jsdom does not load images
   * and a real browser's load would have gone out unauthenticated; and the
   * `src` was an API path. In a browser the visible result is a broken-image
   * glyph and a 401 nothing surfaces.
   */
  it("fetches them through apiFetch and shows a blob URL, never a bare API src", async () => {
    serving();
    await mount();

    const img = host.querySelector<HTMLImageElement>("img.ill-plate");
    expect(img, "no plate is on screen, so nothing below means anything").not.toBeNull();

    expect(
      asked.some((u) => u.endsWith(`GET /api/illustrated/s/${HASH}.jpeg`)),
      "the bytes were never fetched — a bare <img src> would arrive with no Authorization header and 401",
    ).toBe(true);

    const src = img?.getAttribute("src") ?? "";
    expect(src.startsWith("blob:"), `the plate's src is "${src}", not an object URL`).toBe(true);
    expect(src).not.toContain("/api/");
  });

  /**
   * **A response that is not `ok` must become a sentence, not a broken image.**
   * An error body is perfectly good bytes, so `URL.createObjectURL` on it
   * succeeds and hands the `<img>` a blob of JSON — which paints as the same
   * broken glyph a 401 on a bare `src` would, having gone all the way round the
   * fetch to get there. This is the half of "through `apiFetch`" a jsdom test
   * can actually reach: with no Supabase session there is no bearer token to
   * assert, so the header itself is checked by the browser pass and by
   * `AdminFeedbackList`'s neighbours rather than here.
   */
  it("turns a refused plate into the reason, not a broken image", async () => {
    serving({ plateStatus: 401 });
    await mount();
    expect(host.querySelector("img.ill-plate"), "a 401 body was shown as a picture").toBeNull();
    expect(host.querySelector(".ill-plate-out")?.textContent).toContain("did not load (401)");
    expect(URL.createObjectURL, "the error body was made into a blob").not.toHaveBeenCalled();
  });

  it("holds the object URL while the picture is up, and revokes it when it goes", async () => {
    serving();
    await mount();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    /* **Not revoked yet**, which is the half the assertion below cannot make:
       revoking immediately after creating satisfies "was revoked" perfectly and
       leaves an `<img>` pointing at nothing. */
    expect(URL.revokeObjectURL, "revoked while still on screen").not.toHaveBeenCalled();
    act(() => root.unmount());
    expect(URL.revokeObjectURL, "the blob is held until the tab closes").toHaveBeenCalledWith(
      "blob:spideryarn/plate-1",
    );
    /* The `afterEach` unmounts too, and unmounting twice throws. Re-made here
       so the shared teardown has something live to take down. */
    root = createRoot(host);
  });
});

describe("what it depicts", () => {
  /**
   * **The caption in the row is the caption on the plate**, and the row is still
   * where the claim lives. Since 2026-09-04 the picture carries a short title
   * under each scene (docs/project/diagram.md § The picture carries words now);
   * the row repeats it so a reader who has read one off a vignette can find the
   * passage it came from. A plate drawn before that, or one drawn wordless,
   * carries no title and the row must show none — a caption in the list that is
   * not on the picture points at nothing.
   */
  it("shows the plate's own caption above what the row depicts, and only when there is one", async () => {
    serving();
    await mount();

    const row = host.querySelector<HTMLButtonElement>(".ill-row");
    expect(row?.querySelector(".ill-caption")?.textContent).toBe("CLOCKWORK SKULL");
    /* The quote is still there and still unclamped: the caption is wayfinding,
       the quote is the claim. */
    expect(row?.querySelector(".ill-quote")?.textContent).toContain(QUOTE.slice(0, 20));

    /* One row, one caption — a caption rendered for a row that has no title
       would be pointing at a word that is not on the picture, and the ternary
       that decides it is the only thing standing between the two. */
    expect(host.querySelectorAll(".ill-caption").length).toBe(
      host.querySelectorAll(".ill-row").length,
    );
  });

  it("jumps the article to the block its quote was checked against", async () => {
    serving();
    const jumped: BlockId[] = [];
    await mount((id) => jumped.push(id));

    const rows = [...host.querySelectorAll<HTMLButtonElement>(".ill-row")];
    /**
     * **One row from three vignettes, and the two that went are the point.**
     * The artefact carries a vignette naming a block this article does not
     * have, and one whose quote is a real contiguous sentence of the article
     * taken from the block *next door*. Both are rows that would land the
     * reader in a paragraph not containing what they had just read, and both
     * are refused in the browser on arrival (`readStoredIllustrated`,
     * useIllustrated.ts). A fixture with only the good one passes whether the
     * panel validates or renders the wire straight out.
     */
    expect(rows.length, "the browser is not re-checking the rows it was sent").toBe(1);
    expect(host.textContent, "a row was drawn for a block this article does not have").not.toContain(
      "no longer has",
    );
    expect(host.textContent, "a quote from the block next door was accepted").not.toContain(
      "next door",
    );
    expect(rows[0]?.textContent).toContain("clockwork skull");
    /* The article's own words, not a paraphrase of them — this is how a reader
       reads the picture back against the piece. */
    expect(rows[0]?.textContent).toContain(QUOTE);

    await act(async () => {
      rows[0]?.click();
    });
    expect(jumped, "pressing a row went nowhere").toEqual(["spya-b0"]);
  });

  /**
   * **A jump from full screen must close the overlay, and this is a bug that
   * shipped in the first draft.** A modal `<dialog>` makes everything behind it
   * `inert`, so the article scrolled where nobody could see it and the press
   * read as doing nothing at all — no movement, no message, no error.
   * `Lightbox.tsx` closes before following a link for the same reason.
   * GPT Sol, 2026-09-03.
   */
  it("closes the overlay when a row is pressed from full screen", async () => {
    serving();
    const jumped: BlockId[] = [];
    await mount((id) => jumped.push(id));

    const dialog = host.querySelector<HTMLDialogElement>("dialog.ill-full");
    expect(dialog, "no overlay to enlarge into").not.toBeNull();
    /* jsdom implements neither, and `<dialog>` without them never reports open. */
    if (dialog) {
      dialog.showModal = function showModal(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      };
      dialog.close = function close(this: HTMLDialogElement) {
        this.removeAttribute("open");
        this.dispatchEvent(new Event("close"));
      };
    }

    await act(async () => {
      host.querySelector<HTMLButtonElement>(".ill-zoom")?.click();
    });
    await settle();
    expect(dialog?.hasAttribute("open"), "Enlarge did not open the overlay").toBe(true);

    const row = host.querySelector<HTMLButtonElement>("dialog.ill-full .ill-row");
    expect(row, "the list is not reachable inside the overlay").not.toBeNull();
    await act(async () => {
      row?.click();
    });
    await settle();

    expect(jumped, "the row did not jump").toEqual(["spya-b0"]);
    expect(
      dialog?.hasAttribute("open"),
      "the article scrolled behind a modal that stayed up — the press looks like it did nothing",
    ).toBe(false);
    expect(host.querySelector(".ill-elsewhere"), "the band is stuck saying it is full screen").toBeNull();
  });

  it("says the picture is an interpretation, in a visible line rather than a tooltip", async () => {
    serving();
    await mount();
    const says = host.querySelector(".ill-says");
    expect(says, "nothing on screen says this picture cannot be checked").not.toBeNull();
    expect(says?.textContent).toContain("not a diagram of it");
  });

  it("shows the brief, because a prompt can be read against the article where a picture cannot", async () => {
    serving();
    await mount();
    expect(host.querySelector(".ill-brief")?.textContent).toContain("vellum page");
  });
});

describe("a plate the run could not paint", () => {
  /**
   * A run keeps the plates it managed to draw and records why the others have
   * none, so this is a real stored state rather than a corruption. Drawing a
   * gap for it would make "not painted" and "the panel is broken" look the same.
   */
  it("says so in place, rather than leaving a gap", async () => {
    serving();
    await mount();

    const chips = [...host.querySelectorAll<HTMLButtonElement>(".ill-plate-chip")];
    /* **Every plate, not just the drawn ones.** A plate filtered out of the row
       cannot say why it has no picture; it is simply absent, which is the gap
       docs/project/diagram.md § Illustrated refuses. */
    expect(chips.length, "the plate row is not drawn, or drops the plates with no picture").toBe(3);
    await act(async () => {
      chips[1]?.click();
    });
    await settle();

    expect(host.querySelector("img.ill-plate"), "a failed plate cannot have a picture").toBeNull();
    expect(host.querySelector(".ill-plate-out")?.textContent).toContain("refused this plate");
  });

  /**
   * **The arm of the union that spun for ever**, found by reading
   * `withStoredOutcome` rather than by looking at the panel: a stored plate can
   * carry neither an image nor a failure — its `image` record did not parse, or
   * it predates the schema — and the first draft of `Plate` treated "no URL
   * yet" as "a fetch is in flight". Nothing was in flight and nothing was
   * coming: a spinner for ever, no error, no request. docs/reusable/silent-success.md.
   */
  it("does not spin for ever on a plate that has neither a picture nor a reason", async () => {
    serving();
    await mount();
    const chips = [...host.querySelectorAll<HTMLButtonElement>(".ill-plate-chip")];
    await act(async () => {
      chips[2]?.click();
    });
    await settle();

    const out = host.querySelector(".ill-plate-out");
    expect(out?.textContent, "the undrawn plate says nothing").toContain("no picture stored");
    expect(
      out?.querySelector(".cmt-spinner"),
      "still spinning, with no request out and none coming",
    ).toBeNull();
    /* And its rows survive, because the words are what is left of it. */
    expect(host.querySelectorAll(".ill-row").length).toBe(1);
  });

  it("gives every plate its own tab stop, and leaves the arrows to the article", async () => {
    serving();
    await mount();
    const chips = [...host.querySelectorAll<HTMLButtonElement>(".ill-plate-chip")];
    for (const chip of chips) expect(chip.tabIndex).toBe(0);

    await act(async () => {
      chips[0]?.focus();
      chips[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    const after = [...host.querySelectorAll<HTMLButtonElement>(".ill-plate-chip")];
    expect(
      after[0]?.getAttribute("aria-checked"),
      "an arrow press moved the plate row — on this page the arrows belong to the article, and an arrow must never buy a $0.40 job",
    ).toBe("true");
  });
});

describe("the empty state, which has three refusals to tell apart", () => {
  /**
   * The step refuses when the Sketch is absent, stale, or drawn for a different
   * reader profile — always before the brief call, so nothing is spent. Each of
   * the three has to say which one it is, because they send the reader to
   * different places.
   */
  const cases = [
    { name: "absent", sketch: null, says: "no Sketch of this article yet" },
    { name: "stale", sketch: { stale: true, profileChanged: false }, says: "out of date" },
    { name: "profile-changed", sketch: { stale: false, profileChanged: true }, says: "reader profile you have since changed" },
  ] as const;

  for (const c of cases) {
    it(`names the ${c.name} Sketch and still points at the chip one to the left`, async () => {
      serving({ noArtefact: true, sketch: c.sketch });
      await mount();

      const why = host.querySelector(`[data-ill-refusal="${c.name}"]`);
      expect(why, `the ${c.name} refusal is not distinguished from the other two`).not.toBeNull();
      expect(why?.textContent).toContain(c.says);
      /* **The other route survives the one-press button.** A reader who wants
         to look at the Sketch before spending anything on a painting is not
         doing something wrong, and the sentence that tells them how is the only
         thing that says so. */
      expect(why?.textContent, "the way to draw the Sketch on its own is gone").toContain("Sketch");
    });
  }

  /**
   * **The sentence above the branch, which every test up to here reads straight
   * past.**
   *
   * They all query `[data-ill-refusal]`, which is the *second* paragraph. The
   * first one said *"there is no Sketch to paint from"* for all three branches
   * until 2026-09-03 — true of `absent`, and flatly contradicted in the other
   * two by the sentence immediately underneath it, which describes the Sketch
   * that supposedly does not exist. A reader has no way to tell which half to
   * believe. GPT Sol found it; nothing here could have, and that gap is the
   * reason this test exists rather than the wording.
   *
   * **Two assertions, and they do different jobs.** The `toBe` is the gate: the
   * headline is one sentence for all three branches, so pinning it is what makes
   * a rewrite come back and re-read it against all three. The regex is what says
   * *why* — it rejects the class, a bare denial of the Sketch's existence, and
   * it is the half that still bites when somebody rewrites the copy and this
   * constant together. Neither alone is enough: `toBe` would wave through a
   * matched pair of wrong sentences, and the regex cannot tell a missing
   * headline from a good one.
   */
  const REFUSAL_HEAD =
    "Nobody has painted this one yet, and there is no usable Sketch to paint from.";

  for (const c of cases) {
    it(`does not deny the Sketch it then describes (${c.name})`, async () => {
      serving({ noArtefact: true, sketch: c.sketch });
      await mount();

      const why = host.querySelector("[data-ill-refusal]");
      expect(why, `no ${c.name} refusal on screen, so nothing below means anything`).not.toBeNull();
      expect(
        why?.previousElementSibling?.textContent,
        `the ${c.name} refusal's headline is not the one sentence that is true of all three`,
      ).toBe(REFUSAL_HEAD);

      /* `absent` is the one branch where denying the Sketch is the truth, and it
         says so in its own words — so the contradiction below is only ever
         asked of the two where a Sketch exists. */
      if (c.sketch === null) return;
      expect(
        why?.textContent,
        `the ${c.name} branch stopped describing the Sketch, so there is nothing left for the headline to contradict and this test has quietly stopped testing anything`,
      ).toContain("The Sketch of this article");
      expect(
        `${why?.previousElementSibling?.textContent} ${why?.textContent}`,
        `the ${c.name} panel says there is no Sketch and then describes the Sketch`,
      ).not.toMatch(/(?:is|are) no Sketch\b(?! of this article yet)/);
    });
  }

  /**
   * **The reversal, and the condition it came with.**
   *
   * These three states dead-ended until 2026-09-03: no button, because
   * `illustrated` on its own would certainly be refused. Greg asked for one
   * press that draws the Sketch and then paints — which is the `enqueue(["sketch",
   * "illustrated"])` the previous day's plan refused as *"a hidden $0.20 charge
   * and a three-minute wait that nothing warned about"*.
   *
   * **The objection was to the hiding.** So the assertion that matters here is
   * not that a button exists — it is that all four numbers are on screen
   * *beside* it, in front of the press. A button with only the painting's price
   * under it would pass a laxer version of this test and would be the exact
   * thing the old refusal was protecting against.
   *
   * Written red first against the three dead ends: `.ill-run` was null, so the
   * button assertion failed on every one of the three, and `data-ill-both-cost`
   * did not exist.
   */
  for (const c of cases) {
    it(`offers one press that draws and then paints, with both prices in front of it (${c.name})`, async () => {
      serving({ noArtefact: true, sketch: c.sketch });
      await mount();

      const run = host.querySelector(".ill-run");
      expect(run, `the ${c.name} Sketch is still a dead end`).not.toBeNull();
      expect(run?.textContent).toContain("Draw the Sketch, then paint");

      const cost = host.querySelector("[data-ill-both-cost]")?.textContent ?? "";
      /* Every one of the four, because a sentence that names three of them is a
         sentence that hides one — and which one it hides is not a detail: the
         Sketch's are the two the reader did not ask for. */
      for (const said of ["about $0.20", "about two minutes", "$0.40–$0.65", "four to seven minutes"]) {
        expect(cost, `"${said}" is not said before the press`).toContain(said);
      }
      /* And nothing was bought by reading the sentence. */
      expect(posted, "arriving at a refusal posted a job").toEqual([]);
    });
  }

  /**
   * **What the press actually asks for**, which the button's own label cannot
   * establish and a request count cannot either.
   *
   * One job naming both steps, not two jobs sequenced by the browser: a tab
   * closed between the two POSTs would leave a Sketch drawn and paid for and no
   * painting. `orderSteps` (src/jobs.ts) sorts the names by `STEP_ORDER`, so
   * the server is what guarantees the Sketch runs first.
   *
   * **And unforced** — for the reason src/web/useIllustrated.ts §
   * `drawThenPaint` gives, which is not the one this docstring gave until
   * 2026-09-03. It said *"forcing `sketch` would cascade over every step after
   * it, redrawing a Sketch that may be perfectly current — $0.20 for nothing"*,
   * and no part of that is how the code behaves: a force from this hook names
   * `illustrated` and never `sketch` (`force: [step]` in useStepJob.ts), and
   * both steps are in `FORCE_ONLY_WHEN_NAMED`, so the positional cascade cannot
   * speak for either. What `force` would actually cost is the work key —
   * `workKeyFor` hashes it, so a forced press and an unforced one are two jobs
   * at $0.40–$0.65 rather than one. Which is why the assertion is `force`
   * **absent** rather than an empty array: `parseJobRequest` reads the two the
   * same way and `workKeyFor` does not.
   */
  it("posts one job naming both steps, unforced", async () => {
    serving({ noArtefact: true, sketch: { stale: true, profileChanged: false } });
    await mount();

    const button = [...host.querySelectorAll<HTMLButtonElement>(".ill-run button")].find((b) =>
      b.textContent?.includes("Draw the Sketch, then paint"),
    );
    expect(button, "no one-press button to press").not.toBeUndefined();
    await act(async () => {
      button?.click();
    });
    await settle();

    expect(posted.length, "one press did not buy exactly one job").toBe(1);
    expect(posted[0]?.slug).toBe("s");
    expect(posted[0]?.steps, "the press did not ask for both steps in one job").toEqual([
      "sketch",
      "illustrated",
    ]);
    expect(
      posted[0]?.force,
      "the press forced something — a different work key from the unforced press beside it, so two tabs buy two $0.40–$0.65 jobs",
    ).toBeUndefined();
  });

  /**
   * **While the Sketch half runs, the band is progress and not a button.**
   *
   * The failure this is written against is specific and quiet: the panel is
   * still in its `none` state — there is no painting, and there will not be one
   * for six to nine minutes — so if the refusal branch went on drawing its
   * sentence and its button, a reader would be looking at *"there is no Sketch
   * to paint from"* and a pressable button over a paid job that was already
   * drawing one. Pressing again is the loop the whole feature exists to close.
   *
   * The job here has **two steps with the Sketch running**, which is what a job
   * from this button looks like a minute in — and it is seeded through the job
   * list rather than by pressing, because that is also what a run started in
   * another tab looks like.
   */
  it("shows the Sketch half running, rather than the refusal and a live button", async () => {
    serving({
      noArtefact: true,
      sketch: null,
      jobs: [
        {
          id: "job-1",
          slug: "s",
          status: "running",
          createdAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          steps: [
            { name: "sketch", label: "Drawing the argument", status: "running", startedAt: new Date().toISOString() },
            { name: "illustrated", label: "Painting the argument", status: "pending" },
          ],
        },
      ],
    });
    await mount();

    expect(host.textContent, "the reader is not told anything is happening").toContain(
      "Drawing the argument",
    );
    expect(
      host.querySelector(".cmt-spinner"),
      "a two-step job is running and nothing on screen is moving",
    ).not.toBeNull();
    expect(
      host.querySelector('[data-ill-refusal="absent"]'),
      "the refusal is still on screen over a job that is drawing the Sketch right now",
    ).toBeNull();
    const pressable = [...host.querySelectorAll<HTMLButtonElement>("button")].filter((b) =>
      b.textContent?.includes("Draw the Sketch, then paint"),
    );
    expect(pressable, "the button is still pressable, so a second job is one click away").toEqual([]);
    /* And there is a way out of it, which is the other half of "not a dead
       spinner": a six-to-nine-minute job the reader cannot stop is worse than
       one they never started. */
    expect(host.textContent).toContain("Stop");
  });

  it("names the price before the press when there IS a Sketch to paint from", async () => {
    serving({ noArtefact: true, sketch: { stale: false, profileChanged: false } });
    await mount();

    const why = host.querySelector(".ill-empty-why");
    expect(why?.textContent, "the dearest button in the app does not say what it costs").toContain(
      "$0.40–$0.65",
    );
    expect(host.querySelector(".ill-run"), "no way to ask for one").not.toBeNull();
  });

  it("starts nothing on merely arriving, with no artefact and nothing armed", async () => {
    serving({ noArtefact: true, sketch: { stale: false, profileChanged: false } });
    await mount();
    expect(
      asked.filter((u) => u.startsWith("POST ")),
      "arriving at the chip posted something — the only paid thing here is a press",
    ).toEqual([]);
    expect(pendingActivation("s", "illustrated"), "a token was minted by arriving").toBeNull();
  });
});

/* ------------------------------------------------------------- the chip -- */

function article(): { root: SummaryNode; blocks: Block[] } {
  const blocks = BLOCKS.slice();
  const tree = {
    version: "1", generator: "t", slug: "s", rootId: "n1",
    nodes: {
      n1: {
        id: "n1", depth: 0, parent: null, children: [],
        range: [blocks[0]?.id, blocks[1]?.id], title: "Section n1", gist: "Gist for n1",
      },
    },
  } as unknown as Tree;
  const summary = buildSummaryTree(tree, blocks);
  if (!summary) throw new Error("fixture tree is unusable");
  return { root: summary, blocks };
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("the chip in the diagram row", () => {
  /**
   * **The visitor case this file could not have before.**
   *
   * The chip is the cheapest way into a $0.20 draw — one press arms
   * `armActivation` — so the assertion that matters for a shared link is that
   * a visitor has no chip at all, rather than a disabled one. Not rendered, not
   * hidden: `hidden` leaves an element a later change can reveal.
   */
  it("is absent for a visitor, along with the whole picker", async () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    serving({ noArtefact: true, sketch: null });
    const { root: tree, blocks } = article();
    await act(async () => {
      root.render(
        <DiagramPanel
          access={{ kind: "visitor" }}
          experimental={false}
          slug="s" root={tree} kind="force" onKind={() => {}} atRow={0} onJump={() => {}}
          blocks={blocks} axis="spread" onAxis={() => {}} hue="section" onHue={() => {}}
        />,
      );
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(host.querySelector('[data-diag-kind="illustrated"]'), "no Illustrated chip").toBeNull();
    expect(host.querySelector("[data-diag-kind]"), "no picker at all").toBeNull();
    /* Not vacuous: the panel really did mount and draw its band. */
    expect(host.querySelector(".mode-band.diag"), "the band").not.toBeNull();
  });


  it("is there for an owner, and `access` is what keeps it from a visitor", async () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    serving({ noArtefact: true, sketch: null });
    const { root: tree, blocks } = article();
    await act(async () => {
      root.render(
        <DiagramPanel
          access={{ kind: "owner" }}
          experimental
          slug="s" root={tree} kind="force" onKind={() => {}} atRow={0} onJump={() => {}}
          blocks={blocks} axis="spread" onAxis={() => {}} hue="section" onHue={() => {}}
        />,
      );
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(host.querySelector('[data-diag-kind="illustrated"]'), "no Illustrated chip").not.toBeNull();
    /* **What keeps this chip from a visitor changed on 2026-09-04**, and the
       assertion had to change with it. Diagram mode used to be owners-only
       outright, so a visitor never reached the row the chip is in and the check
       here was on `visitorGap`. A visitor reaches the panel now — pinned to the
       free picture — so the thing that keeps them from a $0.20 draw is the
       panel's own `access`, not the mode's policy.
       docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 2. */
    expect(visitorGap("diagram", {} as never)).toBeNull();
  });

  /**
   * **Pressing it arms; arriving at it does not.** `?diagram=` is query state,
   * so Back and Forward move it and a pasted URL sets it — none of which may
   * buy a $0.40–$0.65, four-to-seven-minute job. Only the click mints a token.
   */
  it("arms the job when pressed, and not when the panel merely renders it", async () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    serving({ noArtefact: true, sketch: { stale: false, profileChanged: false } });
    const { root: tree, blocks } = article();

    /** The panel, on whichever picture the URL says. */
    const show = async (kind: "force" | "illustrated") => {
      await act(async () => {
        root.render(
          <DiagramPanel
            access={{ kind: "owner" }}
          experimental
            slug="s" root={tree} kind={kind} onKind={() => {}} atRow={0} onJump={() => {}}
            blocks={blocks} axis="spread" onAxis={() => {}} hue="section" onHue={() => {}}
          />,
        );
        await new Promise((r) => setTimeout(r, 0));
      });
      await settle();
    };

    /* **Arriving.** A pasted `?mode=diagram&diagram=illustrated`, or a Back
       press, renders the whole view with no click anywhere. */
    await show("illustrated");
    expect(
      pendingActivation("s", "illustrated"),
      "rendering the mode armed a paid job — a pasted URL would then spend money",
    ).toBeNull();
    expect(
      asked.filter((u) => u.startsWith("POST ")),
      "arriving at the picture posted a job",
    ).toEqual([]);

    /* **Pressing.** From another picture, which is where the gesture actually
       happens — the chip is not offered on the picture it selects. */
    await show("force");
    const chip = host.querySelector<HTMLButtonElement>('[data-diag-kind="illustrated"]');
    await act(async () => {
      chip?.click();
    });
    expect(
      pendingActivation("s", "illustrated"),
      "the press armed nothing, so the picture would open empty and the reader would have to press twice",
    ).not.toBeNull();

    /* **And the press is then spent, once, on a real POST.** `onKind` is a
       no-op in this file, so the view has to be rendered by hand — which is the
       hole GPT Sol found in the first version of this test: it stopped at the
       token and proved nothing about whether anything was ever queued, or
       queued twice, or queued forced. */
    await show("illustrated");
    const posts = asked.filter((u) => u.startsWith("POST /api/jobs"));
    expect(posts.length, "the armed press bought nothing, or bought two jobs").toBe(1);
    expect(
      pendingActivation("s", "illustrated"),
      "the token survived being spent, so the next status change would spend it again",
    ).toBeNull();
  });

  /**
   * **The press must not be spent before the Sketch has answered**, and this is
   * the expensive one. The refusal is a *server* check made when the queued job
   * runs, not when it is enqueued — so a job queued behind a Sketch that is
   * still drawing is refused today and billed the moment that Sketch lands,
   * with the panel's refusal copy hiding the run that is under way.
   * GPT Sol, 2026-09-03.
   */
  it("holds an armed press while the Sketch's own answer is still in flight", async () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    /* The artefact 404s and `/api/sketch/:slug` never settles — exactly the
       window in which the old code spent the press. */
    serving({ noArtefact: true, hangSketch: true });
    const { root: tree, blocks } = article();

    await act(async () => {
      root.render(
        <DiagramPanel
          access={{ kind: "owner" }}
          experimental
          slug="s" root={tree} kind="force" onKind={() => {}} atRow={0} onJump={() => {}}
          blocks={blocks} axis="spread" onAxis={() => {}} hue="section" onHue={() => {}}
        />,
      );
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-diag-kind="illustrated"]')?.click();
    });

    await act(async () => {
      root.render(
        <DiagramPanel
          access={{ kind: "owner" }}
          experimental
          slug="s" root={tree} kind="illustrated" onKind={() => {}} atRow={0} onJump={() => {}}
          blocks={blocks} axis="spread" onAxis={() => {}} hue="section" onHue={() => {}}
        />,
      );
      await new Promise((r) => setTimeout(r, 0));
    });
    await settle();

    expect(
      asked.filter((u) => u.startsWith("POST /api/jobs")),
      "a paid job was queued before we knew whether the Sketch would refuse it",
    ).toEqual([]);
    /* Held rather than retired: the reader's press is still good, and it is
       spent the moment the Sketch's answer says it can be. */
    expect(
      pendingActivation("s", "illustrated"),
      "the press was thrown away while waiting, so the reader would have to press again",
    ).not.toBeNull();
  });

  /**
   * **Sketch and Illustrated, adjacent and in that order**, because every
   * refusal sentence in this mode says *"the chip one to the left"*. A row that
   * reordered itself would make that instruction wrong with nothing failing.
   */
  it("puts Illustrated immediately to the right of Sketch", async () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    serving({ noArtefact: true, sketch: null });
    const { root: tree, blocks } = article();
    await act(async () => {
      root.render(
        <DiagramPanel
          access={{ kind: "owner" }}
          experimental
          slug="s" root={tree} kind="force" onKind={() => {}} atRow={0} onJump={() => {}}
          blocks={blocks} axis="spread" onAxis={() => {}} hue="section" onHue={() => {}}
        />,
      );
      await new Promise((r) => setTimeout(r, 0));
    });
    const kinds = [...host.querySelectorAll("[data-diag-kind]")].map((el) =>
      el.getAttribute("data-diag-kind"),
    );
    expect(kinds.indexOf("illustrated")).toBe(kinds.indexOf("sketch") + 1);
  });
});
