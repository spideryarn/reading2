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
        { block: "spya-b0", quote: QUOTE, depicts: "A clockwork skull being pulled apart on a workbench" },
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

interface Serving {
  /** 404 the artefact, which is the ordinary case for an unpainted article. */
  noArtefact?: boolean;
  /** What `GET /api/sketch/:slug` answers, or 404 when absent. */
  sketch?: { stale: boolean; profileChanged: boolean } | null;
  /** What the plate's bytes route answers. 200 unless a test says otherwise. */
  plateStatus?: number;
  /** Hold `GET /api/sketch/:slug` open, so `checking` can be observed. */
  hangSketch?: boolean;
}

function serving(opts: Serving = {}) {
  asked = [];
  vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    /* The method as well as the URL, because the assertion that matters most
       here is that nothing was **posted** — the job list is polled on a GET by
       a tab-level engine this component does not control, so counting requests
       to `/api/jobs` would prove nothing either way. */
    asked.push(`${(init?.method ?? "GET").toUpperCase()} ${u}`);
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
    if (u.includes("/api/jobs")) return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
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
   * reader profile — always before the brief call, so nothing is spent. The
   * refusal being free is exactly why the button must not be offered: a press
   * that cannot work costs no money and still lies about what it does.
   */
  const cases = [
    { name: "absent", sketch: null, says: "no Sketch of this article yet" },
    { name: "stale", sketch: { stale: true, profileChanged: false }, says: "out of date" },
    { name: "profile-changed", sketch: { stale: false, profileChanged: true }, says: "reader profile you have since changed" },
  ] as const;

  for (const c of cases) {
    it(`names the ${c.name} Sketch and points at the chip instead of offering a button`, async () => {
      serving({ noArtefact: true, sketch: c.sketch });
      await mount();

      const why = host.querySelector(`[data-ill-refusal="${c.name}"]`);
      expect(why, `the ${c.name} refusal is not distinguished from the other two`).not.toBeNull();
      expect(why?.textContent).toContain(c.says);
      expect(why?.textContent).toContain("Sketch");
      expect(
        host.querySelector(".ill-run"),
        "a button was offered for a run that would certainly be refused",
      ).toBeNull();
    });
  }

  it("names the price before the press when there IS a Sketch to paint from", async () => {
    serving({ noArtefact: true, sketch: { stale: false, profileChanged: false } });
    await mount();

    const why = host.querySelector(".ill-empty-why");
    expect(why?.textContent, "the dearest button in the app does not say what it costs").toContain(
      "$0.27–$0.40",
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
  it("is there for an owner, and Diagram mode is what keeps it from a visitor", async () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    serving({ noArtefact: true, sketch: null });
    const { root: tree, blocks } = article();
    await act(async () => {
      root.render(
        <DiagramPanel
          slug="s" root={tree} kind="force" onKind={() => {}} atRow={0} onJump={() => {}}
          blocks={blocks} axis="spread" onAxis={() => {}} hue="section" onHue={() => {}}
        />,
      );
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(host.querySelector('[data-diag-kind="illustrated"]'), "no Illustrated chip").not.toBeNull();
    /* And the reason there is no visitor case to test in this file: the whole
       of Diagram mode is owners-only, so a visitor never reaches the row the
       chip is in. tests/public-network-trace.tsx holds the band a visitor gets
       instead. */
    expect(visitorGap("diagram", {} as never)).toEqual({ kind: "owners-only", feature: "Diagram" });
  });

  /**
   * **Pressing it arms; arriving at it does not.** `?diagram=` is query state,
   * so Back and Forward move it and a pasted URL sets it — none of which may
   * buy a $0.27–$0.40, four-to-seven-minute job. Only the click mints a token.
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
