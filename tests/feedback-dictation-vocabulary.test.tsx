// @vitest-environment jsdom
/**
 * **Does the Feedback dialog's microphone carry the app's own words?**
 *
 * Greg, from inside that very dialog, 2026-09-04:
 *
 * > I am using the microphone button on the feedback dialogue box itself, and
 * > often when I mention Spideryarn, it spells it wrong. Which seems weird
 * > because I thought we had added a bunch of stuff to the vocabulary. Is
 * > Spideryarn itself in the list of vocabulary things we send?
 *
 * It is, and it is first — tests/vocabulary.test.ts § SITE_TERMS pins that. So
 * the report is really a question about the *path*: a vocabulary that is
 * assembled and never sent looks exactly like one that was never assembled,
 * which is docs/project/dictation.md § The ways it fails, failure 3.
 *
 * tests/transcribe.test.ts already proves the server end — every recipe names
 * `site`, and the terms reach the request. What was untested until this file is
 * **the two joins in front of it**, both of which this dialog owns:
 *
 *  1. the dialog hands `useDictation` a `context` at all (it is the one caller
 *     that derives it from a `where` prop rather than from the router), and
 *  2. the upload puts that context in the body, so the server has a place to
 *     turn into words.
 *
 * Break either and every dictation still works, still returns a transcript, and
 * quietly spells the product's name however the model guesses it.
 *
 * Nothing here opens a microphone or calls a model: `useDictation` is replaced
 * by a spy that records what it was handed, `apiFetch` records the POST, and
 * `fetch` records the OpenRouter request. What is read is what we sent.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------- the mocks -- */

/** What the dialog handed the microphone hook. */
let handed: unknown = null;

vi.mock("../src/web/useDictation.js", () => ({
  useDictation: (options: { context: unknown }) => {
    handed = options.context;
    return {
      supported: true,
      armed: false,
      transcribing: false,
      error: null,
      live: false,
      seconds: 0,
      level: 0,
      toggle: () => {},
    };
  },
}));

vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => createElement("button", { type: "button" }, "mic"),
  DictationStrip: () => null,
}));

/** The dialog's own POST, and the transcription upload's, in arrival order. */
const posts: { input: string; init: RequestInit }[] = [];
vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (input: string, init: RequestInit) => {
    posts.push({ input, init });
    return new Response(JSON.stringify({ text: "" }), { status: 200 });
  },
  failure: async (res: Response) => new Error(await res.text()),
}));

/* Not the router: the Feedback dialog is told where it is by its `where` prop,
   because FeedbackButton has already read the route. That is the join this file
   is about, so it is given a real prop rather than a mocked hook. */

/* Re-encoding a screenshot needs a canvas jsdom has not got, and no test here
   attaches one. */
vi.mock("../src/web/feedback-screenshot.js", () => ({
  screenshotFromFile: async () => ({ ok: false, problem: "not-an-image" }),
  imageFileFromPaste: () => null,
  imageFileFromDrop: () => null,
}));

/**
 * The store, as the article the reader was reading.
 *
 * Given something to say, so that a green result means "the site's words *and*
 * this article's words arrived" rather than "the site's words arrived because
 * everything else failed".
 */
vi.mock("../src/store/index.js", () => ({
  readerStore: { readProfile: async () => "" },
  shelfStore: { read: async () => ({ opens: 0 }) },
  loadArticle: async (slug: string) => {
    if (slug !== "a-piece") throw new Error("no article");
    return {
      meta: { title: "The Xanadu Papers", byline: "Ted Nelson" },
      blocks: [{ kind: "text", text: "What Xanadu promised, Xanadu did not deliver." }],
    };
  },
  loadGlossary: async (slug: string) => {
    if (slug !== "a-piece") throw new Error("no glossary");
    return { glossary: { entries: [{ name: "transclusion", aliases: [], centrality: 0.9 }] } };
  },
}));

const { FeedbackDialog } = await import("../src/web/FeedbackDialog.js");
const { sendForTranscription } = await import("../src/web/dictation-upload.js");
const { parseWhere, transcribe } = await import("../src/transcribe.js");

/* --------------------------------------------------------- the machinery -- */

let host: HTMLDivElement;
let root: Root;

/** What went to OpenRouter. */
const calls: { body: Record<string, unknown> }[] = [];

beforeEach(() => {
  handed = null;
  posts.length = 0;
  calls.length = 0;
  process.env.OPENROUTER_API_KEY = "test-key";
  const proto = window.HTMLDialogElement?.prototype;
  if (proto) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    proto.close = function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    calls.push({ body: JSON.parse(init.body) as Record<string, unknown> });
    /* The transcription endpoint's answer, not chat/completions' — dictation
       moved on 2026-09-07 and a `{choices: […]}` reply here would be a stub
       shaped like a wire this app no longer speaks, which is a green test about
       nothing. docs/plans/260907c-dictation-onto-an-openai-transcriber.md. */
    return new Response(JSON.stringify({ text: "Spideryarn" }), { status: 200 });
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(slug: string | null) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root.render(
      createElement(FeedbackDialog, {
        open: true,
        onClose: () => {},
        where: { url: "https://www.spideryarn.com/read/a-piece", slug },
      }),
    );
  });
}

/** Past the floor under which nothing is sent to the model at all. */
const AUDIO = "A".repeat(8_000);

/**
 * The words the model would have received, however they are carried.
 *
 * They used to be a `<vocabulary>` fence inside a user message; since
 * 2026-09-07 they are `provider.options.openai.keywords`, a list in a field of
 * its own. **The tests below did not change** — what a reader of a report cares
 * about is that Spideryarn and the article's own words reach the model, not
 * which envelope they travel in — so the change is confined to this function,
 * which is why it exists.
 *
 * It **throws when the field is absent** rather than returning empty. An empty
 * vocabulary and an unsent one are the same string and very different bugs, and
 * the whole report behind this file was a suspicion that the words were not
 * arriving (docs/reusable/silent-success.md).
 */
async function vocabularySentFor(context: unknown): Promise<string> {
  const where = parseWhere(context);
  if (!where) throw new Error("the server would refuse this context");
  await transcribe(AUDIO, "webm", where);
  const provider = calls[0]?.body.provider as
    | { options?: { openai?: { keywords?: unknown } } }
    | undefined;
  const keywords = provider?.options?.openai?.keywords;
  if (!Array.isArray(keywords))
    throw new Error("no keywords in the request — the vocabulary never left");
  return (keywords as string[]).join(", ");
}

/* ------------------------------------------------------------- the tests -- */

describe("the Feedback dialog's microphone", () => {
  it("tells the hook which article the reader is reporting from", () => {
    mount("a-piece");
    expect(handed).toEqual({ kind: "article", slug: "a-piece" });
  });

  it("falls back to the reader's own words off an article", () => {
    mount(null);
    expect(handed).toEqual({ kind: "profile" });
  });

  it("puts that context in the transcription request", async () => {
    mount("a-piece");
    const blob = new Blob([new Uint8Array(64)], { type: "audio/webm" });
    await sendForTranscription(blob, "audio/webm;codecs=opus", handed as never);
    const upload = posts.find((p) => p.input === "/api/transcribe");
    if (!upload) throw new Error("nothing was sent to /api/transcribe");
    const body = JSON.parse(String(upload.init.body)) as Record<string, unknown>;
    expect(body.context).toEqual(handed);
    expect(body.format).toBe("webm");
  });

  /**
   * **The report itself, end to end.** Greg's dictation into this box has to
   * arrive at the model with the app's own words attached — his name included,
   * since he is the one the app names and the word he was dictating about.
   */
  it("carries the app's own words, and Greg's name, all the way to the model", async () => {
    mount("a-piece");
    const words = (await vocabularySentFor(handed)).split(", ");
    expect(words).toContain("Spideryarn");
    expect(words).toContain("Greg Detre");
  });

  it("carries the article's own words too, not only the app's", async () => {
    mount("a-piece");
    const words = (await vocabularySentFor(handed)).split(", ");
    expect(words).toContain("transclusion");
    expect(words).toContain("Xanadu");
  });

  it("still has the app's own words when the reader is not in an article", async () => {
    mount(null);
    const words = (await vocabularySentFor(handed)).split(", ");
    expect(words).toContain("Spideryarn");
    expect(words).toContain("Greg Detre");
  });
});
