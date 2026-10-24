// @vitest-environment jsdom
/**
 * **Resting on a citation starts *Does it say that?* and streams it into the
 * card** — plan docs/plans/261024m-citation-card-streams-a-note-on-what-this-paragraph-cites-the-work-for.md,
 * stage 2 (the client), as overridden by § After GPT Sol's review.
 *
 * The real `ProseHoverCard` over the markup `annotateHtml` produces (the
 * harness is tests/citation-hover-card.test.tsx's), the real loader
 * (src/web/cite-check.ts) and the real `runTurn`; only `apiFetch` is replaced,
 * by a chat route that holds threads and streams a turn frame by frame as the
 * test pushes them. What is asked is what a reader and a bill would notice:
 * when a request leaves, what the card draws while it runs and after, and when
 * nothing is sent at all.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askDoesItSayThatAboutBlock } from "../src/chat-question.js";
import type { Block, BlockId, CitedWork, ThreadSummary } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "a-piece";
const ONE = "spya-k3m9qt" as BlockId;
const TWO = "spya-p7w2dn" as BlockId;
const REFS = "spya-m5n6p7" as BlockId;
const THREAD = "spya-th7ead";
const AT = "2026-10-24T12:00:00.000Z";

/** The fake chat route: what it holds, what it was asked, and how it answers the next POST. */
const server = vi.hoisted(() => ({
  threads: [] as unknown[],
  posts: [] as Record<string, unknown>[],
  gets: 0,
  failGets: 0,
  /** `"stream"`, or a refusal to answer with. */
  reply: "stream" as "stream" | { status: number; body: unknown },
  push: null as ((event: string, data: unknown) => void) | null,
  end: null as (() => void) | null,
}));

vi.mock("../src/web/lib/api.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/lib/api.js")>();
  return {
    ...real,
    apiFetch: async (url: string, init?: RequestInit) => {
      if (url !== `/api/chat/${SLUG}`) throw new Error(`the test made an unexpected request: ${url}`);
      if ((init?.method ?? "GET") === "GET") {
        server.gets++;
        if (server.failGets > 0) {
          server.failGets--;
          return Response.json({ error: "Temporarily unavailable." }, { status: 503 });
        }
        return Response.json({ threads: server.threads });
      }
      server.posts.push(JSON.parse(String(init?.body)));
      if (server.reply !== "stream") {
        return new Response(JSON.stringify(server.reply.body), {
          status: server.reply.status,
          headers: { "content-type": "application/json" },
        });
      }
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          server.push = (event, data) =>
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          server.end = () => controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  };
});

/* `api.js` builds a Supabase client at import, from variables only a browser
   bundle has. Nothing here signs in. */
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      refreshSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));

const { ProseHoverCard, CONTINUE_IN_CHAT, DOES_IT_SAY_THAT } = await import("../src/web/ProseHoverCard.js");
type CiteCheckSenders = import("../src/web/ProseHoverCard.js").CiteCheckSenders;
const { annotateHtml, citeMarks } = await import("../src/web/annotate.js");
const { buildNoteIndex } = await import("../src/web/notes-view.js");
const { HOVER_DELAY } = await import("../src/web/useHoverCard.js");
const { noteReader } = await import("../src/web/lib/reader-change.js");
const {
  CITE_CHECK_FAILED,
  CITE_CHECK_READING,
  CITE_CHECK_WRITING,
  forgetCiteChecks,
  pressCiteCheck,
} = await import("../src/web/cite-check.js");

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const block = (id: BlockId, html: string): Block => {
  const text = html.replace(/<[^>]+>/g, "");
  return { id, tag: "p", kind: "text", text, words: text.split(/\s+/).length, html, gistable: true };
};

const BLOCKS: Block[] = [
  block(ONE, "<p>Context is reinstated at retrieval (Tulving 1983), and that matters.</p>"),
  block(TWO, "<p>Two papers agree (Kaplan; Hoffmann) on this.</p>"),
  block(REFS, "<p>Tulving, E. (1983). Elements of Episodic Memory.</p>"),
];

function work(over: Partial<CitedWork> & Pick<CitedWork, "id" | "title">): CitedWork {
  return {
    key: `work:${over.title}`,
    why: "What the piece uses it for.",
    mentions: [],
    citedAt: [ONE],
    firstCited: ONE,
    citedInBody: true,
    url: "https://doi.org/10.1000/xyz",
    linkFrom: "doi",
    ...over,
  };
}

/** Cited in ONE, and listed in the references (REFS). */
const TULVING = work({
  id: "spya-a2b3c4",
  title: "Elements of Episodic Memory",
  authors: "Tulving",
  year: "1983",
  mentions: [{ blockId: ONE, quote: "(Tulving 1983)", start: 40 }],
  reference: { blockId: REFS, quote: "Tulving, E. (1983)", start: 0 },
});
/** Two works over one phrase in TWO: the card names both. */
const KAPLAN = work({
  id: "spya-d5e6f7",
  title: "Scaling Laws",
  mentions: [{ blockId: TWO, quote: "(Kaplan; Hoffmann)", start: 16 }],
  citedAt: [TWO],
});
const HOFFMANN = work({
  id: "spya-h4v8zr",
  title: "Compute-Optimal Training",
  mentions: [{ blockId: TWO, quote: "(Kaplan; Hoffmann)", start: 16 }],
  citedAt: [TWO],
});
const WORKS = [TULVING, KAPLAN, HOFFMANN];

const continued: string[] = [];
const pressed: [string, BlockId][] = [];
const refreshed: string[] = [];
/** What the harness's *Does it say that?* press decided, as Reader's `checkCitedWork` would. */
const decisions: unknown[] = [];

function Harness({ senders, owner }: { senders: CiteCheckSenders | null; owner: boolean }) {
  const cites = citeMarks(
    BLOCKS,
    WORKS.map((w) => ({
      id: w.id,
      places: [...w.mentions, ...(w.reference ? [w.reference] : [])].map((p) => ({
        blockId: p.blockId,
        quote: p.quote,
      })),
    })),
  );
  return (
    <>
      <table>
        <tbody>
          {BLOCKS.map((b) => (
            <tr key={b.id} data-block={b.id}>
              <td>
                <div
                  className="prose"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: standing in for TableView
                  dangerouslySetInnerHTML={{ __html: annotateHtml(b.html, cites.get(b.id) ?? []) }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ProseHoverCard
        entries={[]}
        works={WORKS}
        slug={owner ? SLUG : null}
        sourceUrl={null}
        blockText={new Map(BLOCKS.map((b) => [b.id, b.text]))}
        notes={buildNoteIndex([])}
        lookUpLinks={false}
        canAddToShelf={false}
        showInSpideryarn={owner}
        termActions={null}
        onAskCitedWork={owner ? () => {} : null}
        onCheckCitedWork={
          owner
            ? (w, id) => {
                pressed.push([w.id, id]);
                decisions.push(pressCiteCheck({ slug: SLUG, workId: w.id, blockId: id }));
              }
            : null
        }
        citeCheck={senders}
        onOpenTerm={() => {}}
        onJump={() => {}}
        onFollowNote={() => {}}
      />
    </>
  );
}

const senders = (summaries: ThreadSummary[] = [], loaded = true): CiteCheckSenders => ({
  slug: SLUG,
  summaries,
  summariesLoaded: loaded,
  onContinue: (id) => void continued.push(id),
  onRefresh: () => void refreshed.push("refresh"),
});

let host: HTMLDivElement;
let root: Root;

function paint(s: CiteCheckSenders | null = senders(), owner = true): void {
  act(() => root.render(<Harness senders={s} owner={owner} />));
}

function pointer(type: string, target: Element, pointerType = "mouse"): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 10, detail: 1 });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "isPrimary", { value: true });
  target.dispatchEvent(event);
}

/** Let promises and the stream's reads run, at the current fake time. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
  });
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

/** Rest the pointer until the card is open; the 2 s rest starts then. */
async function hover(target: Element): Promise<void> {
  act(() => pointer("pointerover", target));
  await wait(HOVER_DELAY.open);
}

/** Leave the mark and let the card close. */
async function leave(target: Element): Promise<void> {
  act(() => {
    pointer("pointerout", target);
    pointer("pointerover", document.body);
  });
  await wait(HOVER_DELAY.close + 10);
}

/** A complete touch tap. */
function tap(target: Element): void {
  act(() => {
    for (const type of ["pointerover", "pointerdown", "pointerup", "pointerout"]) pointer(type, target, "touch");
    pointer("mouseup", target, "touch");
    pointer("click", target, "touch");
  });
}

const card = () => document.querySelector(".prose-card");
const section = () => document.querySelector(".prose-card-check");
const answer = () => document.querySelector(".prose-card-check-answer");
const caret = () => document.querySelector(".prose-card-check .prose-card-caret");
const activity = () => document.querySelector(".prose-card-check-activity")?.textContent ?? null;
const line = () => document.querySelector(".prose-card-check-line")?.textContent ?? null;
const continueButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>(".prose-card-check button")].find(
    (b) => b.textContent?.trim() === CONTINUE_IN_CHAT,
  );
const pressButton = () =>
  [...(card()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (b) => b.textContent?.trim() === DOES_IT_SAY_THAT,
  );
const tulvingMark = () =>
  host.querySelector(`tr[data-block="${ONE}"] mark.cite`) as HTMLElement;
const twoWorkMark = () => host.querySelector(`tr[data-block="${TWO}"] mark.cite`) as HTMLElement;
const referenceMark = () => host.querySelector(`tr[data-block="${REFS}"] mark.cite`) as HTMLElement;

/** Open the card on Tulving and wait out the rest: the check is sent. */
async function restOnTulving(): Promise<void> {
  await hover(tulvingMark());
  await wait(2000);
}

function storedThread(answerText: string, status: "done" | "pending" | "error" = "done") {
  return {
    id: THREAD,
    title: "Does it say that?",
    createdAt: AT,
    updatedAt: AT,
    kind: "chat",
    anchor: { blockId: ONE },
    origin: { mode: "cite-check", itemId: TULVING.id, blockId: ONE, quote: TULVING.title },
    messages: [
      { id: "spya-q00001", role: "user", text: "q", createdAt: AT, status: "done" },
      { id: "spya-a00001", role: "assistant", text: answerText, createdAt: AT, status },
    ],
  };
}

const summaryOf = (t: ReturnType<typeof storedThread>): ThreadSummary =>
  ({
    id: t.id,
    title: t.title,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    anchor: t.anchor,
    kind: "chat",
    turns: 1,
    origin: t.origin,
  }) as ThreadSummary;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  server.threads = [];
  server.posts = [];
  server.gets = 0;
  server.failGets = 0;
  server.reply = "stream";
  server.push = null;
  server.end = null;
  continued.length = 0;
  pressed.length = 0;
  decisions.length = 0;
  refreshed.length = 0;
  forgetCiteChecks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  forgetCiteChecks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("when the check starts", () => {
  it("sends nothing before the card has been open 2 s, and one automatic check at 2 s", async () => {
    paint();
    await hover(tulvingMark());
    expect(card()).not.toBeNull();
    await wait(1999);
    expect(server.posts, "a check left before the 2 s rest").toEqual([]);
    expect(section(), "the section drew before anything started").toBeNull();
    await wait(1);
    expect(server.posts).toHaveLength(1);
    const sent = server.posts[0] as Record<string, unknown>;
    expect(sent.auto).toBe(true);
    expect(sent.anchor).toEqual({ blockId: ONE });
    expect(sent.origin).toEqual({ mode: "cite-check", itemId: TULVING.id, blockId: ONE, quote: TULVING.title });
    /* The server rebuilds the question and refuses a different one (C4). */
    expect(sent.question).toBe(askDoesItSayThatAboutBlock(TULVING, ONE));
    expect(activity()).toBe(CITE_CHECK_READING);
  });

  it("sends nothing when the card closes before 2 s, even later", async () => {
    paint();
    await hover(tulvingMark());
    await wait(1000);
    await leave(tulvingMark());
    expect(card()).toBeNull();
    await wait(5000);
    expect(server.posts).toEqual([]);
  });

  it("sends nothing when the pointer leaves in the card's visual close delay", async () => {
    paint();
    await hover(tulvingMark());
    await wait(1999);
    act(() => pointer("pointerover", document.body));
    await wait(1);
    expect(server.posts, "the close hysteresis counted as resting on the citation").toEqual([]);
    await wait(1000);
    expect(server.posts).toEqual([]);
  });

  it("sends nothing on a card naming two works", async () => {
    paint();
    await hover(twoWorkMark());
    expect(card()?.textContent).toContain("Scaling Laws");
    expect(card()?.textContent).toContain("Compute-Optimal Training");
    await wait(3000);
    expect(server.posts).toEqual([]);
    expect(section()).toBeNull();
  });

  it("sends nothing on the card over a reference entry", async () => {
    paint();
    await hover(referenceMark());
    expect(card()?.textContent).toContain("Elements of Episodic Memory");
    await wait(3000);
    expect(server.posts).toEqual([]);
  });

  it("sends nothing for a visitor", async () => {
    paint(null, false);
    await hover(tulvingMark());
    expect(card()).not.toBeNull();
    await wait(3000);
    expect(server.posts).toEqual([]);
    expect(server.gets).toBe(0);
  });

  it("sends nothing when a finger opened the card (C8), and the button is still there", async () => {
    paint();
    tap(tulvingMark());
    expect(card()).not.toBeNull();
    expect(pressButton()).toBeDefined();
    await wait(3000);
    expect(server.posts).toEqual([]);
  });

  it("starts after a mouse takes over the same card a finger opened", async () => {
    paint();
    tap(tulvingMark());
    expect(card()).not.toBeNull();
    act(() => pointer("pointerover", tulvingMark()));
    await wait(2000);
    expect(server.posts).toHaveLength(1);
  });
});

describe("while it runs, and after", () => {
  it("draws the activity, then the answer as a stream with a caret, then Continue in Chat", async () => {
    paint();
    await restOnTulving();
    await act(async () => server.push?.("begin", { threadId: THREAD, title: "t", messageId: "spya-a00001" }));
    await settle();
    expect(activity()).toBe(CITE_CHECK_READING);
    await act(async () =>
      server.push?.("tool", { index: 0, run: { name: "read_cited_work", label: "read the cited work", status: "running" } }),
    );
    await settle();
    expect(activity()).toBe("Reading the paper…");
    await act(async () =>
      server.push?.("tool", { index: 0, run: { name: "read_cited_work", label: "read the cited work", status: "done", ms: 9 } }),
    );
    await settle();
    expect(activity()).toBe(CITE_CHECK_WRITING);
    await act(async () => server.push?.("delta", { text: "Mostly. The paper says so" }));
    await settle();
    expect(answer()?.textContent).toContain("Mostly. The paper says so");
    expect(caret(), "no caret while the answer arrives").not.toBeNull();
    await act(async () => {
      server.push?.("done", { text: "Mostly. The paper says so in §3." });
      server.end?.();
    });
    await settle();
    expect(answer()?.textContent).toContain("Mostly. The paper says so in §3.");
    expect(caret(), "the caret outlived the answer").toBeNull();
    expect(activity()).toBeNull();
    act(() => continueButton()?.click());
    expect(continued).toEqual([THREAD]);
    expect(card(), "Continue in Chat left the card open").toBeNull();
  });

  it("keeps reading after the card closes mid-stream, and a second rest shows the text without a second send", async () => {
    paint();
    await restOnTulving();
    await act(async () => server.push?.("begin", { threadId: THREAD, title: "t", messageId: "spya-a00001" }));
    await act(async () => server.push?.("delta", { text: "Partly" }));
    await settle();
    await leave(tulvingMark());
    expect(card()).toBeNull();
    await act(async () => server.push?.("delta", { text: ", and here is why." }));
    await settle();
    await hover(tulvingMark());
    expect(answer()?.textContent).toContain("Partly, and here is why.");
    expect(caret()).not.toBeNull();
    await act(async () => {
      server.push?.("done", { text: "Partly, and here is why." });
      server.end?.();
    });
    await settle();
    await wait(3000);
    expect(server.posts, "the second rest sent again").toHaveLength(1);
    expect(caret()).toBeNull();
  });

  it("drops an off-card finished answer when refreshed summaries say its thread was deleted", async () => {
    paint();
    await restOnTulving();
    await act(async () => server.push?.("begin", { threadId: THREAD, title: "t", messageId: "spya-a00001" }));
    await leave(tulvingMark());
    await act(async () => {
      server.push?.("done", { text: "An answer deleted in Chat." });
      server.end?.();
    });
    await settle();
    paint(senders([], true));
    await hover(tulvingMark());
    expect(answer()?.textContent ?? "", "the deleted thread's cached answer returned").not.toContain(
      "An answer deleted in Chat.",
    );
    await wait(2000);
    expect(server.posts, "the deleted key did not become startable again").toHaveLength(2);
  });

  it("draws a chat the summaries already hold, read from the server, without a send", async () => {
    const stored = storedThread("Yes: section 2 says exactly this.");
    server.threads = [stored];
    paint(senders([summaryOf(stored)]));
    await hover(tulvingMark());
    await wait(3000);
    expect(server.posts).toEqual([]);
    expect(server.gets).toBe(1);
    expect(answer()?.textContent).toContain("Yes: section 2 says exactly this.");
    expect(continueButton()).toBeDefined();
  });

  it("stops polling an elsewhere answer when the card closes, and resumes on return", async () => {
    const stored = storedThread("", "pending");
    server.threads = [stored];
    paint(senders([summaryOf(stored)]));
    await hover(tulvingMark());
    await settle();
    expect(server.gets).toBe(1);
    await leave(tulvingMark());
    await wait(5000);
    expect(server.gets, "a closed card kept polling").toBe(1);
    await hover(tulvingMark());
    await settle();
    expect(server.gets, "returning did not resume the lookup").toBe(2);
  });

  it("retries an existing thread after a transient read failure", async () => {
    const stored = storedThread("The recovered answer.");
    server.threads = [stored];
    server.failGets = 1;
    paint(senders([summaryOf(stored)]));
    await hover(tulvingMark());
    await settle();
    expect(server.gets).toBe(1);
    await leave(tulvingMark());
    await hover(tulvingMark());
    await settle();
    expect(server.gets, "the failed read suppressed every later read").toBe(2);
    expect(answer()?.textContent).toContain("The recovered answer.");
  });

  it("refreshes stale summaries when their full thread is missing", async () => {
    const missing = storedThread("gone");
    paint(senders([summaryOf(missing)]));
    await hover(tulvingMark());
    await settle();
    expect(server.gets).toBe(1);
    expect(refreshed, "the stale summary was left in place").toEqual(["refresh"]);
  });

  it("a failure draws its one line, with Continue in Chat when there is a chat", async () => {
    paint();
    await restOnTulving();
    await act(async () => server.push?.("begin", { threadId: THREAD, title: "t", messageId: "spya-a00001" }));
    await act(async () => {
      server.push?.("error", { error: "The model failed.", text: "" });
      server.end?.();
    });
    await settle();
    expect(line()).toBe(CITE_CHECK_FAILED);
    expect(continueButton()).toBeDefined();
  });
});

describe("refusals", () => {
  const capped: [string, number, string][] = [
    ["hour", 429, "That's 8 automatic checks in the last hour. Press Does it say that? to ask anyway."],
    ["day", 429, "You've had today's 20 automatic checks. Press Does it say that? to ask anyway."],
    ["global", 503, "Automatic checks are paused for everyone today, and resting here again will get the same answer. Press Does it say that? to ask anyway. [cite-check-resting]"],
  ];
  for (const [reason, status, sentence] of capped) {
    it(`draws the ${reason} cap's sentence and asks nothing more`, async () => {
      server.reply = { status, body: { error: sentence, reason } };
      paint();
      await restOnTulving();
      expect(line()).toBe(sentence);
      expect(answer()).toBeNull();
      await leave(tulvingMark());
      await restOnTulving();
      expect(server.posts, "a capped citation asked again on the next rest").toHaveLength(1);
      expect(line()).toBe(sentence);
    });
  }

  it("tries an hourly cap again after its rolling window has passed", async () => {
    server.reply = {
      status: 429,
      body: { error: "That's 8 automatic checks in the last hour.", reason: "hour" },
    };
    paint();
    await restOnTulving();
    expect(server.posts).toHaveLength(1);
    await leave(tulvingMark());
    await wait(60 * 60 * 1000 + 1);
    server.reply = "stream";
    await restOnTulving();
    expect(server.posts, "the expired cap stayed for the life of the tab").toHaveLength(2);
  });

  it("draws nothing when two are already running (busy), and the next rest tries again", async () => {
    server.reply = { status: 429, body: { error: "Two automatic checks are already running.", reason: "busy" } };
    paint();
    await restOnTulving();
    expect(section()).toBeNull();
    await leave(tulvingMark());
    await restOnTulving();
    expect(server.posts).toHaveLength(2);
  });

  it("adopts the chat a 409 names: reads it and draws its answer", async () => {
    server.threads = [storedThread("Not quite: it says the opposite.")];
    server.reply = { status: 409, body: { error: "A chat already exists.", threadId: THREAD } };
    paint();
    await restOnTulving();
    expect(server.posts).toHaveLength(1);
    expect(server.gets).toBe(1);
    expect(answer()?.textContent).toContain("Not quite: it says the opposite.");
    expect(line()).toBeNull();
  });
});

describe("a change of reader (C3)", () => {
  it("clears a check mid-stream, and the old stream's later frames draw nothing", async () => {
    noteReader("reader-a");
    paint();
    await restOnTulving();
    await act(async () => server.push?.("begin", { threadId: THREAD, title: "t", messageId: "spya-a00001" }));
    await act(async () => server.push?.("delta", { text: "A's answer" }));
    await settle();
    expect(answer()?.textContent).toContain("A's answer");
    const oldPush = server.push;
    const oldEnd = server.end;
    act(() => noteReader("reader-b"));
    expect(section(), "B was shown A's check").toBeNull();
    await act(async () => {
      oldPush?.("delta", { text: " and more of it" });
      oldPush?.("done", { text: "A's answer and more of it" });
      oldEnd?.();
    });
    await settle();
    expect(section(), "a frame from A's stream landed for B").toBeNull();
    noteReader(null);
  });
});

describe("the Does it say that? press", () => {
  it("during the rest cancels the timer: no automatic check, now or on a later rest", async () => {
    paint();
    await hover(tulvingMark());
    await wait(1000);
    act(() => pressButton()?.click());
    expect(pressed).toEqual([[TULVING.id, ONE]]);
    expect(decisions).toEqual([{ start: true }]);
    await wait(3000);
    await hover(tulvingMark());
    await wait(3000);
    expect(server.posts, "the rest sent a second chat beside the press's").toEqual([]);
  });

  it("with a chat already known opens it and sends nothing", async () => {
    const stored = storedThread("Yes.");
    server.threads = [stored];
    paint(senders([summaryOf(stored)]));
    await hover(tulvingMark());
    await wait(500);
    act(() => pressButton()?.click());
    expect(decisions).toEqual([{ open: THREAD }]);
    expect(server.posts).toEqual([]);
  });

  it("while an automatic check is starting waits for its thread rather than starting another", async () => {
    paint();
    await restOnTulving();
    act(() => pressButton()?.click());
    const decided = decisions[0] as { wait: Promise<{ open: string }> };
    expect(decided.wait).toBeInstanceOf(Promise);
    await act(async () => server.push?.("begin", { threadId: THREAD, title: "t", messageId: "spya-a00001" }));
    await settle();
    await expect(decided.wait).resolves.toEqual({ open: THREAD });
    expect(server.posts).toHaveLength(1);
  });
});
