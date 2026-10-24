/**
 * **A citation's *Does it say that?*, started by resting on its card** — the
 * client half of plan
 * docs/plans/261024m-citation-card-streams-a-note-on-what-this-paragraph-cites-the-work-for.md
 * (option C, as overridden by § After GPT Sol's review).
 *
 * The check is an ordinary chat, one per cited work and citing paragraph
 * (origin `cite-check`, `CiteCheckOrigin` in src/types.ts), created by the
 * chat route like any other. What lives here is the part the card cannot hold
 * itself: the card is torn down on pointer-out, and the answer takes 15–30 s,
 * so the stream is read by this module and the card only draws what it says.
 *
 * ## What it keeps, and for how long (C5)
 *
 * **State only while a stream of its own is in flight.** Otherwise the thread
 * is the record: its first assistant answer is read from `GET /api/chat/:slug`
 * (`askForThreads`, the one reader of that list), and read again when the
 * summary's `updatedAt` moves, so a retry in Chat shows here, and dropped when
 * the summaries stop listing it, so a deleted chat frees the key. A cap's
 * line is kept too, for the tab, so a second rest on a capped citation does
 * not ask again.
 *
 * ## The guards
 *
 * - **Single-flight per key**, and never twice: an entry in any state but
 *   idle means nothing is sent for that key again.
 * - **At most two of its own streams in flight per tab** (`MAX_IN_FLIGHT`), so
 *   the server's concurrency refusal is a backstop.
 * - **A reader change forgets everything** (`forgetOnReaderChange`), and a
 *   generation fence makes every callback from the previous reader's stream
 *   inert (C3): a stream outlives the change, its frames do not land.
 * - **View-as sends nothing** (`viewAsNonce`), as the link card's lookups.
 *
 * The stream is read with `runTurn` (src/web/chat/effects.ts), so there is no
 * third SSE reader, and its refusals arrive with their details (C2): a 409
 * carrying a thread id adopts that thread; a cap's 429 or 503 is a line.
 *
 * Reader hears of a thread on `begin` and when it settles (`onCiteCheckThread`)
 * so it can refresh the chat summaries; this module never reaches into Reader.
 */
import { useSyncExternalStore } from "react";
import { askDoesItSayThatAboutBlock } from "../chat-question.js";
import { mintId } from "../ids.js";
import { type BlockId, type CiteCheckOrigin, type CitedWork, originName, type ToolRun } from "../types.js";
import { askForThreads, runTurn, type TurnRefusal } from "./chat/effects.js";
import { forgetOnReaderChange } from "./lib/reader-change.js";
import { viewAsNonce } from "./lib/view-as.js";

/** How long the card rests open before the check starts (plan § When it starts). */
export const CITE_CHECK_REST_MS = 2000;

/** The most of this tab's own automatic checks reading at once (plan § At a cap). */
export const MAX_IN_FLIGHT = 2;

/** Between looks at an answer still being written elsewhere, and how many. */
export const CITE_CHECK_POLL_MS = 4000;
const MAX_POLLS = 60;

/** The activity line before anything else is known (C9). */
export const CITE_CHECK_READING = "Reading…";
/** Once the last tool has settled, or words have arrived. */
export const CITE_CHECK_WRITING = "Writing…";
/** A failure with a chat to go to (plan § A failure). */
export const CITE_CHECK_FAILED = "This check didn't finish. Continue in Chat to try again.";
/** A failure before the server made a chat: there is nothing to continue. */
export const CITE_CHECK_FAILED_UNSTARTED = "This check didn't finish. Press Does it say that? to try again.";
/** The saved answer is still being written by another tab or an earlier visit. */
export const CITE_CHECK_ELSEWHERE = "Still reading — the answer will be in Chat.";

/**
 * **What a running tool is doing, in the card's words.** By name, because
 * the tool's own label is written in the past tense for Chat's list once it
 * has finished (`describeCall`, src/chat-tools.ts); the card needs the
 * present. A tool not named here is still something being looked up.
 */
export function citeCheckActivity(toolName: string): string {
  switch (toolName) {
    case "read_cited_work":
      return "Reading the paper…";
    case "search_web":
      return "Searching the web…";
    case "read_web_page":
      return "Reading a web page…";
    default:
      return "Looking things up…";
  }
}

/** Which check: the article, the cited work and the citing paragraph. */
export interface CiteCheckKey {
  slug: string;
  workId: string;
  blockId: BlockId;
}

/** What a check's question is built from. */
export type CiteCheckWork = Pick<CitedWork, "id" | "title" | "authors" | "year">;

/** What the card draws. */
export type CiteCheckView =
  /** Nothing known here; the card draws nothing. */
  | { kind: "idle" }
  /** This tab's own stream. `threadId` is null until `begin`. */
  | { kind: "streaming"; threadId: string | null; text: string; activity: string }
  /** The thread's first answer, finished. */
  | { kind: "done"; threadId: string; text: string }
  /** The thread's first answer is still being written somewhere else; polled. */
  | { kind: "elsewhere"; threadId: string }
  /** The server said no in a sentence for the reader: a cap, or a stale citation. */
  | { kind: "said"; message: string }
  /** It did not finish. `threadId` when there is a chat holding the error. */
  | { kind: "failed"; threadId: string | null };

export const CITE_CHECK_IDLE: CiteCheckView = { kind: "idle" };

/** A thread this module saw begin or settle, for Reader to refresh its summaries. */
export interface CiteCheckThreadEvent {
  threadId: string;
  phase: "begun" | "settled";
}

interface Entry {
  view: CiteCheckView;
  /** A stream of this tab's is in flight for the key. */
  own: boolean;
  /** `threadId@updatedAt` of the last read from the server, so it is read once per change. */
  readFor: string | null;
  /** The summaries have listed this key's thread, so their dropping it means it was deleted. */
  listed: boolean;
  /** The thread this tab's own stream finished, whose first listing needs no second read. */
  ownSettled: string | null;
  /** The *Does it say that?* button was pressed: nothing automatic for this key. */
  pressed: boolean;
  /** The pending automatic start, if a card is resting. */
  timer: ReturnType<typeof setTimeout> | null;
  /** Presses waiting for an in-flight start's thread id. */
  begunWaiters: ((threadId: string | null) => void)[];
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const threadListeners = new Set<(event: CiteCheckThreadEvent) => void>();
let inFlight = 0;
/** Moves on every reader change; a callback from an older generation does nothing. */
let generation = 0;

function keyOf(key: CiteCheckKey): string {
  return `${key.slug}\n${key.workId}\n${key.blockId}`;
}

function entryFor(key: CiteCheckKey): Entry {
  const k = keyOf(key);
  let entry = entries.get(k);
  if (!entry) {
    entry = {
      view: CITE_CHECK_IDLE,
      own: false,
      readFor: null,
      listed: false,
      ownSettled: null,
      pressed: false,
      timer: null,
      begunWaiters: [],
    };
    entries.set(k, entry);
  }
  return entry;
}

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function tellThread(event: CiteCheckThreadEvent): void {
  for (const listener of [...threadListeners]) {
    try {
      listener(event);
    } catch {
      // One listener's failure must not stop the others hearing.
    }
  }
}

function setView(entry: Entry, view: CiteCheckView): void {
  entry.view = view;
  emit();
}

/** The origin a check's thread stores: the work, the paragraph, the title cut to the cap. */
export function citeCheckOrigin(work: CiteCheckWork, blockId: BlockId): CiteCheckOrigin {
  return { mode: "cite-check", itemId: work.id, blockId, quote: originName(work.title) };
}

/** What the card draws for `key` now. */
export function citeCheckView(key: CiteCheckKey): CiteCheckView {
  return entries.get(keyOf(key))?.view ?? CITE_CHECK_IDLE;
}

/** The view for `key`, re-rendering when it changes. `null` draws idle. */
export function useCiteCheck(key: CiteCheckKey | null): CiteCheckView {
  const get = () => (key ? citeCheckView(key) : CITE_CHECK_IDLE);
  return useSyncExternalStore(subscribe, get, get);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Hear of every thread a check begins or settles. Returns the unsubscribe. */
export function onCiteCheckThread(listener: (event: CiteCheckThreadEvent) => void): () => void {
  threadListeners.add(listener);
  return () => threadListeners.delete(listener);
}

/**
 * **Start the check after the rest**, unless it has a reason not to: returns
 * the cancel, which the card calls on unmount or a change of key. Once the
 * timer has fired, the check carries on whatever the card does.
 */
export function scheduleCiteCheck(key: CiteCheckKey, work: CiteCheckWork, delayMs = CITE_CHECK_REST_MS): () => void {
  const entry = entryFor(key);
  if (entry.pressed || entry.view.kind !== "idle" || entry.own) return () => {};
  if (entry.timer !== null) clearTimeout(entry.timer);
  const gen = generation;
  const timer = setTimeout(() => {
    if (gen !== generation || entry.timer !== timer) return;
    entry.timer = null;
    startCiteCheck(key, work, { auto: true });
  }, delayMs);
  entry.timer = timer;
  return () => {
    if (entry.timer === timer) {
      clearTimeout(timer);
      entry.timer = null;
    }
  };
}

/**
 * **Send the check**, through the chat route as Chat does. Nothing when the
 * key already has anything, when this tab already has two of its own in
 * flight, in view-as, or (for an automatic start) after a press.
 */
export function startCiteCheck(key: CiteCheckKey, work: CiteCheckWork, opts: { auto: boolean }): void {
  if (viewAsNonce() !== null) return;
  const entry = entryFor(key);
  if (entry.own || entry.view.kind !== "idle") return;
  if (opts.auto && entry.pressed) return;
  if (inFlight >= MAX_IN_FLIGHT) return;
  const gen = generation;
  /* Still this entry, of this reader: a reader change empties `entries`, and a
     forgotten key may have been made again since. */
  const live = () => gen === generation && entries.get(keyOf(key)) === entry;
  entry.own = true;
  inFlight += 1;
  let threadId: string | null = null;
  let text = "";
  const runs: ToolRun[] = [];
  let settled = false;
  /** Let go of the in-flight slot once, whichever way the turn ends. */
  const settle = () => {
    if (settled) return;
    settled = true;
    if (gen === generation) inFlight -= 1;
    if (!live()) return;
    entry.own = false;
    const waiters = entry.begunWaiters.splice(0);
    for (const wake of waiters) wake(threadId);
  };
  setView(entry, { kind: "streaming", threadId: null, text: "", activity: CITE_CHECK_READING });
  /* *Reading…* until a tool says what it is doing; that tool's words while
     one runs; *Writing…* once the last has settled or words have come. */
  const activity = (): string => {
    const running = runs.find((run) => run?.status === "running");
    if (running) return citeCheckActivity(running.name);
    return text !== "" || runs.length > 0 ? CITE_CHECK_WRITING : CITE_CHECK_READING;
  };
  const draw = () => {
    if (live()) setView(entry, { kind: "streaming", threadId, text, activity: activity() });
  };
  const question = askDoesItSayThatAboutBlock(work, key.blockId);
  const payload: Record<string, unknown> = {
    question,
    at: key.blockId,
    anchor: { blockId: key.blockId },
    origin: citeCheckOrigin(work, key.blockId),
    ...(opts.auto ? { auto: true } : {}),
  };
  void runTurn(key.slug, mintId(), payload, {
    began: (begun) => {
      if (!live()) return;
      threadId = begun.threadId;
      draw();
      const waiters = entry.begunWaiters.splice(0);
      for (const wake of waiters) wake(threadId);
      tellThread({ threadId, phase: "begun" });
    },
    delta: (more) => {
      if (!live()) return;
      text += more;
      draw();
    },
    tool: (index, run) => {
      if (!live()) return;
      runs[index] = run;
      draw();
    },
    done: (done) => {
      const id = threadId;
      settle();
      if (!live()) return;
      if (id === null) {
        setView(entry, { kind: "failed", threadId: null });
        return;
      }
      entry.ownSettled = id;
      setView(entry, { kind: "done", threadId: id, text: done.text || text });
      tellThread({ threadId: id, phase: "settled" });
    },
    failed: () => {
      const id = threadId;
      settle();
      if (!live()) return;
      setView(entry, { kind: "failed", threadId: id });
      if (id !== null) tellThread({ threadId: id, phase: "settled" });
    },
    refused: (error, refusal) => {
      settle();
      if (!live()) return;
      refusedWith(key, entry, error, refusal);
    },
    disconnected: () => {
      /* The server goes on after a lost connection and stores the answer
         (routes.ts § `streamChat`), so a known thread is looked for rather
         than reported failed. */
      const id = threadId;
      settle();
      if (!live()) return;
      if (id === null) {
        setView(entry, { kind: "failed", threadId: null });
        return;
      }
      entry.view = { kind: "elsewhere", threadId: id };
      void readThread(key, entry, id, null, 0);
      emit();
    },
  });
}

function refusedWith(key: CiteCheckKey, entry: Entry, error: string, refusal: TurnRefusal): void {
  /* Somebody already has a chat for this work and paragraph — another tab, a
     press, a rest the summaries had not heard of. Adopt it: nothing was spent. */
  if (refusal.status === 409 && refusal.threadId !== undefined) {
    entry.view = CITE_CHECK_IDLE;
    void readThread(key, entry, refusal.threadId, null, 0);
    emit();
    return;
  }
  /* Two of this reader's already running: nothing drawn, and the next rest
     tries again, so the entry goes. */
  if (refusal.reason === "busy") {
    forgetEntry(key, entry);
    return;
  }
  /* A cap (hour, day, everybody's day) or a stale citation: the server's
     sentence for the reader, drawn as it came. */
  if (refusal.reason !== undefined || refusal.status === 409) {
    setView(entry, { kind: "said", message: error });
    return;
  }
  setView(entry, { kind: "failed", threadId: null });
}

function forgetEntry(key: CiteCheckKey, entry: Entry): void {
  if (entries.get(keyOf(key)) !== entry) return;
  if (entry.timer !== null) clearTimeout(entry.timer);
  entries.delete(keyOf(key));
  emit();
}

/**
 * **The thread's first answer, from the server.** Pending: drawn as being
 * written elsewhere, and looked at again. Missing: the entry goes, so the next
 * rest may start one. A failed read keeps whatever was drawn.
 */
async function readThread(
  key: CiteCheckKey,
  entry: Entry,
  threadId: string,
  updatedAt: string | null,
  polls: number,
): Promise<void> {
  const gen = generation;
  const stamp = `${threadId}@${updatedAt ?? "?"}`;
  entry.readFor = stamp;
  const live = () => gen === generation && entries.get(keyOf(key)) === entry && !entry.own && entry.readFor === stamp;
  const listed = await askForThreads(key.slug);
  if (!live()) return;
  if (!listed.ok) return;
  const thread = listed.threads.find((t) => t.id === threadId);
  if (!thread) {
    forgetEntry(key, entry);
    return;
  }
  const answer = thread.messages.find((m) => m.role === "assistant");
  if (answer && answer.status === "done") {
    setView(entry, { kind: "done", threadId, text: answer.text });
    return;
  }
  if (answer && answer.status === "error") {
    setView(entry, { kind: "failed", threadId });
    return;
  }
  /* Still being written (or not begun): say so, and look again. */
  if (entry.view.kind !== "done") setView(entry, { kind: "elsewhere", threadId });
  if (polls >= MAX_POLLS) {
    setView(entry, { kind: "failed", threadId });
    return;
  }
  setTimeout(() => {
    if (live()) void readThread(key, entry, threadId, updatedAt, polls + 1);
  }, CITE_CHECK_POLL_MS);
}

/**
 * **Keep the card's answer in step with the chat summaries** (C5), from the
 * card's effect. `summary` is the key's thread as the summaries list it
 * (`threadForOrigin`), or `undefined`; `loaded` is whether they have answered.
 */
export function syncCiteCheck(
  key: CiteCheckKey,
  summary: { id: string; updatedAt: string } | undefined,
  loaded: boolean,
): void {
  const entry = entries.get(keyOf(key));
  if (summary) {
    const target = entry ?? entryFor(key);
    if (target.own) return;
    target.listed = true;
    const stamp = `${summary.id}@${summary.updatedAt}`;
    if (target.readFor === stamp) return;
    /* The answer this tab just finished, listed for the first time: it is
       what was drawn, so no second read. */
    if (target.ownSettled === summary.id && target.readFor === null) {
      target.readFor = stamp;
      return;
    }
    void readThread(key, target, summary.id, summary.updatedAt, 0);
    return;
  }
  /* Listed once and gone now: the chat was deleted, and the key is free. */
  if (entry && loaded && entry.listed && !entry.own) forgetEntry(key, entry);
}

/**
 * **The *Does it say that?* button, routed through the same key** (plan §
 * After GPT Sol's review, last bullet). Cancels a resting card's timer and
 * stops any later automatic start for this key, then says what Reader should
 * do: open a thread this module knows, wait for an in-flight start's thread,
 * or start the chat itself (Reader's own press, which carries the origin).
 */
export function pressCiteCheck(
  key: CiteCheckKey,
): { open: string } | { wait: Promise<string | null> } | { start: true } {
  const entry = entryFor(key);
  entry.pressed = true;
  if (entry.timer !== null) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  const view = entry.view;
  if (view.kind === "streaming" && view.threadId !== null) return { open: view.threadId };
  if (view.kind === "done" || view.kind === "elsewhere") return { open: view.threadId };
  if (view.kind === "failed" && view.threadId !== null) return { open: view.threadId };
  if (entry.own) return { wait: new Promise((wake) => entry.begunWaiters.push(wake)) };
  return { start: true };
}

/** Everything, for a new reader or a test. */
export function forgetCiteChecks(): void {
  generation += 1;
  for (const entry of entries.values()) {
    if (entry.timer !== null) clearTimeout(entry.timer);
    for (const wake of entry.begunWaiters.splice(0)) wake(null);
  }
  entries.clear();
  inFlight = 0;
  emit();
}

forgetOnReaderChange(forgetCiteChecks);
