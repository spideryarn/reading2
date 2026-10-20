/**
 * The add page's purpose save session — src/web/add-purpose.ts, plan
 * docs/plans/261004l-the-add-page-purpose-box-saves-as-you-type.md. Driven
 * through injected requests, with no React: what order the writes go in, that
 * nothing is written before the article's stored purpose has been read, the
 * read's whole lifecycle, and what a retired session still owes its article.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AddPurposeIo,
  AddPurposeSession,
  ADD_PURPOSE_IDLE_MS,
  PURPOSE_READ_DEADLINE_MS,
  PURPOSE_READ_MAX_TRIES,
  PURPOSE_READ_FINAL_TRIES,
  PURPOSE_READ_RETRY_MS,
  type PurposeAnswer,
} from "../src/web/add-purpose.js";

const SLUG = "a-paper";

/**
 * A server with one purpose per article. Reads answer from it; a save is
 * applied when it *lands*, which a test can hold back to put two in flight.
 */
function server(start: { exists?: boolean; stored?: string | null } = {}) {
  const calls: string[] = [];
  const stored = new Map<string, string>();
  if (start.stored) stored.set(SLUG, start.stored);
  const held: Array<{ slug: string; text: string; land(): void; refuse(message: string): void }> = [];
  const world = {
    exists: start.exists ?? true,
    hold: false,
    refuse: null as string | null,
    /** Replaced by a test that needs an odd answer. */
    read: null as ((slug: string, signal: AbortSignal) => Promise<PurposeAnswer>) | null,
  };
  const io: AddPurposeIo = {
    read(slug, signal) {
      calls.push(`read:${slug}`);
      if (world.read) return world.read(slug, signal);
      return Promise.resolve(
        world.exists
          ? { fresh: true, purpose: stored.get(slug) ?? null, purposeFailed: false }
          : { fresh: true, purpose: null, purposeFailed: true },
      );
    },
    save(slug, text) {
      calls.push(`save:${slug}:${text}`);
      const value = text.trim();
      if (world.refuse !== null) return Promise.reject(new Error(world.refuse));
      if (!world.hold) {
        stored.set(slug, value);
        return Promise.resolve(value);
      }
      return new Promise((resolve, reject) => {
        held.push({
          slug,
          text,
          land() {
            stored.set(slug, value);
            resolve(value);
          },
          refuse: (message) => reject(new Error(message)),
        });
      });
    },
    leave(slug, text) {
      calls.push(`leave:${slug}:${text}`);
    },
  };
  return {
    io,
    world,
    calls,
    held,
    stored: (slug = SLUG) => stored.get(slug) ?? null,
    saves: () => calls.filter((c) => c.startsWith("save:")),
    reads: () => calls.filter((c) => c.startsWith("read:")),
  };
}

/** Let promise callbacks run, without moving the clock. */
const tick = () => vi.advanceTimersByTimeAsync(0);

/** A seeded session over an article whose purpose is `stored`. */
async function seeded(s: ReturnType<typeof server>, slug = SLUG) {
  const session = new AddPurposeSession(slug, s.io);
  session.observe(true);
  await tick();
  expect(session.get().seeded).toBe(true);
  return session;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("held until the article exists", () => {
  it("saves nothing while the read says the article is not there, then the typed text once", async () => {
    const s = server({ exists: false });
    const session = new AddPurposeSession(SLUG, s.io);
    session.observe(true);
    session.setText("the evidence", true);
    session.commit();
    await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS * 5);
    expect(s.saves(), "wrote to an article that does not exist yet").toEqual([]);
    expect(s.reads().length).toBeGreaterThan(2);
    expect(session.get().seeded).toBe(false);
    expect(session.get().unsaved, "typed words with nowhere to go were called saved").toBe(true);

    s.world.exists = true;
    await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS);
    expect(s.saves()).toEqual([`save:${SLUG}:the evidence`]);
    expect(session.get().state.kind).toBe("saved");
    expect(session.get().unsaved).toBe(false);
    const reads = s.reads().length;
    await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS * 5);
    expect(s.reads(), "went on reading after it was seeded").toHaveLength(reads);
  });

  it("does not read before the page has said the add is alive, nor with no slug", async () => {
    const s = server();
    const idle = new AddPurposeSession(SLUG, s.io);
    const nowhere = new AddPurposeSession(null, s.io);
    nowhere.observe(true);
    nowhere.setText("typed before any job", true);
    nowhere.commit();
    await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS * 3);
    expect(s.calls).toEqual([]);
    expect(idle.get().seeded).toBe(false);
    expect(nowhere.get().unsaved).toBe(true);
    expect(nowhere.carried()).toBe("typed before any job");
  });

  it("a blank box takes the stored purpose, sends nothing, and is not the reader's text", async () => {
    const s = server({ stored: "why I came" });
    const session = new AddPurposeSession(SLUG, s.io);
    session.setText("x", true);
    session.setText("  ", true);
    session.observe(true);
    await tick();
    expect(session.get().text).toBe("why I came");
    expect(session.get().state.kind).toBe("clean");
    expect(session.carried(), "a stored purpose would follow the reader to another article").toBe("");
    session.commit();
    await tick();
    expect(s.saves()).toEqual([]);
  });

  it("an emptied box clears only once the stored purpose has been read", async () => {
    const s = server({ exists: false, stored: "why I came" });
    const session = new AddPurposeSession(SLUG, s.io);
    session.observe(true);
    session.setText("x", true);
    session.setText("", true);
    session.commit();
    await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS * 2);
    expect(s.saves(), "an empty box erased a purpose the reader could not see").toEqual([]);

    s.world.exists = true;
    await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS);
    expect(s.saves()).toEqual([]);
    expect(session.get().text).toBe("why I came");

    session.setText("", true);
    session.commit();
    await tick();
    expect(s.saves()).toEqual([`save:${SLUG}:`]);
    expect(s.stored()).toBe("");
  });

  it("a box of spaces is an empty box: nothing to send over no purpose, a clear over one", async () => {
    const none = server();
    const fresh = await seeded(none);
    fresh.setText("   ", true);
    fresh.commit();
    await tick();
    expect(none.saves()).toEqual([]);
    expect(fresh.get().unsaved).toBe(false);

    const had = server({ stored: "why I came" });
    const again = await seeded(had);
    again.setText("  ", true);
    again.commit();
    await tick();
    expect(had.saves()).toEqual([`save:${SLUG}:`]);
    expect(again.get().unsaved).toBe(false);
  });

  it("typed words replace the stored purpose at the seed", async () => {
    const s = server({ stored: "why I came" });
    const session = new AddPurposeSession(SLUG, s.io);
    session.setText("the methods", true);
    session.observe(true);
    await tick();
    expect(s.saves()).toEqual([`save:${SLUG}:the methods`]);
    expect(session.get().text).toBe("the methods");
  });
});

describe("one write at a time", () => {
  it("B typed while A is in flight waits for A, then goes once", async () => {
    const s = server();
    const session = await seeded(s);
    s.world.hold = true;
    session.setText("A", true);
    session.commit();
    session.setText("B", true);
    session.commit();
    session.commit();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.saves(), "two writes were in flight at once").toEqual([`save:${SLUG}:A`]);
    expect(session.get().inFlight).toBe(true);
    expect(session.get().state.kind, "said Saving… about words not in the request").toBe("dirty");

    s.held[0]?.land();
    await tick();
    expect(s.saves()).toEqual([`save:${SLUG}:A`, `save:${SLUG}:B`]);
    s.held[1]?.land();
    await tick();
    expect(s.saves()).toHaveLength(2);
    expect(s.stored()).toBe("B");
    expect(session.get().unsaved).toBe(false);
  });

  it("S, then A in flight, then back to S: S is what is stored", async () => {
    const s = server({ stored: "S" });
    const session = await seeded(s);
    s.world.hold = true;
    session.setText("A", true);
    session.commit();
    session.setText("S", true);
    session.commit();
    expect(session.get().state.kind).toBe("clean");
    expect(session.get().unsaved, "clean was taken for settled while A was on its way").toBe(true);
    s.held[0]?.land();
    await tick();
    expect(s.saves()).toEqual([`save:${SLUG}:A`, `save:${SLUG}:S`]);
    s.held[1]?.land();
    await tick();
    expect(s.stored()).toBe("S");
    expect(session.get().unsaved).toBe(false);
  });

  it("shows what the server stored, over the text that was sent", async () => {
    const s = server();
    const session = await seeded(s);
    session.setText("  padded  ", true);
    session.commit();
    await tick();
    expect(session.get().text).toBe("padded");
    expect(session.get().state.kind).toBe("saved");
  });
});

describe("a refusal", () => {
  it("is shown, keeps the words, and is not sent again without an edit or a commit", async () => {
    const s = server();
    const session = await seeded(s);
    s.world.refuse = "The shelf is unavailable.";
    session.setText("A", true);
    session.commit();
    /* A blur while it was in flight: the same words, already being sent. */
    session.commit();
    await tick();
    expect(session.get().state).toEqual({ kind: "error", message: "The shelf is unavailable." });
    expect(session.get().text).toBe("A");
    expect(session.get().unsaved).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.saves(), "a refused write was retried by itself").toEqual([`save:${SLUG}:A`]);

    /* A keystroke clears the refusal: it was about the words that were sent. */
    session.setText("AB", true);
    expect(session.get().state.kind).toBe("dirty");
    s.world.refuse = null;
    session.commit();
    await tick();
    expect(s.saves()).toEqual([`save:${SLUG}:A`, `save:${SLUG}:AB`]);
    expect(session.get().state.kind).toBe("saved");
  });

  it("a commit alone is a new attempt", async () => {
    const s = server();
    const session = await seeded(s);
    s.world.refuse = "no";
    session.setText("A", true);
    session.commit();
    await tick();
    s.world.refuse = null;
    session.commit();
    await tick();
    expect(s.saves()).toHaveLength(2);
    expect(s.stored()).toBe("A");
  });

  it("of older words is not drawn over newer ones, and the newer ones still go", async () => {
    const s = server();
    const session = await seeded(s);
    s.world.hold = true;
    session.setText("A", true);
    session.commit();
    session.setText("B", true);
    session.commit();
    s.held[0]?.refuse("no");
    await tick();
    expect(session.get().state.kind, "a refusal of A was shown over B").not.toBe("error");
    expect(s.saves()).toEqual([`save:${SLUG}:A`, `save:${SLUG}:B`]);
  });

  it("is not retired into a second attempt either", async () => {
    const s = server();
    const session = await seeded(s);
    s.world.refuse = "no";
    session.setText("A", true);
    session.commit();
    await tick();
    await session.retire();
    expect(s.saves()).toHaveLength(1);
  });
});

describe("reading the stored purpose", () => {
  it("asks one at a time, a second apart, while the article is not there", async () => {
    const s = server({ exists: false });
    const session = new AddPurposeSession(SLUG, s.io);
    session.observe(true);
    session.observe(true);
    await tick();
    expect(s.reads()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS - 1);
    expect(s.reads()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.reads()).toHaveLength(2);
  });

  it("does not take an offline copy, or an answer that does not say purposeFailed: false", async () => {
    const s = server({ stored: "why I came" });
    const answers: PurposeAnswer[] = [
      { fresh: false, purpose: "a copy from last week", purposeFailed: false },
      { fresh: true, purpose: null, purposeFailed: undefined },
      { fresh: true, purpose: "why I came", purposeFailed: false },
    ];
    s.world.read = async () => answers.shift() as PurposeAnswer;
    const session = new AddPurposeSession(SLUG, s.io);
    session.observe(true);
    await tick();
    expect(session.get().seeded, "an offline copy was taken as proof the article exists").toBe(false);
    await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS);
    expect(session.get().seeded, "a missing purposeFailed was taken for false").toBe(false);
    await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS);
    expect(session.get().text).toBe("why I came");
  });

  it("gives a read ten seconds, aborts it, and ignores its answer if one comes", async () => {
    const s = server();
    const signals: AbortSignal[] = [];
    let answerFirst: (a: PurposeAnswer) => void = () => {};
    s.world.read = (_slug, signal) => {
      signals.push(signal);
      if (signals.length === 1) {
        return new Promise((resolve) => {
          answerFirst = resolve;
        });
      }
      return Promise.resolve({ fresh: true, purpose: null, purposeFailed: true });
    };
    const session = new AddPurposeSession(SLUG, s.io);
    session.observe(true);
    await vi.advanceTimersByTimeAsync(PURPOSE_READ_DEADLINE_MS - 1);
    expect(s.reads(), "a second read went out beside the first").toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS);
    expect(s.reads()).toHaveLength(2);

    /* Consumed once: the abandoned request's answer is not a seed. */
    answerFirst({ fresh: true, purpose: "late", purposeFailed: false });
    await tick();
    expect(session.get().seeded).toBe(false);
  });

  it("a read that throws is one more try, not the end", async () => {
    const s = server();
    let n = 0;
    s.world.read = async () => {
      n += 1;
      if (n === 1) throw new TypeError("Failed to fetch");
      return { fresh: true, purpose: null, purposeFailed: false };
    };
    const session = new AddPurposeSession(SLUG, s.io);
    session.observe(true);
    await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS);
    expect(session.get().seeded).toBe(true);
  });

  it("gives up after the cap, and says so", async () => {
    const s = server({ exists: false });
    const session = new AddPurposeSession(SLUG, s.io);
    session.setText("the evidence", true);
    session.observe(true);
    await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS * (PURPOSE_READ_MAX_TRIES + 20));
    expect(s.reads()).toHaveLength(PURPOSE_READ_MAX_TRIES);
    expect(session.get().gaveUp).toBe(true);
    expect(session.get().unsaved).toBe(true);
    /* Still alive is not a new run. */
    session.observe(true);
    await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS * 3);
    expect(s.reads()).toHaveLength(PURPOSE_READ_MAX_TRIES);
  });

  it("a read that gave up while the job sat queued starts again at completion", async () => {
    const s = server({ exists: false });
    const session = new AddPurposeSession(SLUG, s.io);
    session.setText("the evidence", true);
    session.observe(true);
    await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS * (PURPOSE_READ_MAX_TRIES + 20));
    expect(session.get().gaveUp).toBe(true);

    s.world.exists = true;
    session.completed();
    await tick();
    expect(session.get().gaveUp).toBe(false);
    expect(session.get().seeded).toBe(true);
    expect(s.saves()).toEqual([`save:${SLUG}:the evidence`]);
  });

  it("a stopped add gets one last try, and a Retry starts a fresh run", async () => {
    const s = server({ exists: false });
    const session = new AddPurposeSession(SLUG, s.io);
    session.setText("the evidence", true);
    session.observe(true);
    await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS * 2);
    const before = s.reads().length;

    session.observe(false);
    await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS * 10);
    expect(s.reads(), "a stopped add did not get exactly one last try").toHaveLength(before + 1);
    expect(session.get().gaveUp).toBe(false);

    s.world.exists = true;
    session.observe(true);
    await tick();
    expect(session.get().seeded).toBe(true);
    expect(s.saves()).toEqual([`save:${SLUG}:the evidence`]);
  });

  it("an add first seen stopped is still asked once: its row may have been made", async () => {
    const s = server({ stored: "why I came" });
    const session = new AddPurposeSession(SLUG, s.io);
    session.observe(false);
    await tick();
    expect(s.reads()).toHaveLength(1);
    expect(session.get().text).toBe("why I came");
  });

  it("an answer arriving after the session was retired does nothing", async () => {
    const s = server();
    let answer: (a: PurposeAnswer) => void = () => {};
    s.world.read = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    const session = new AddPurposeSession(SLUG, s.io);
    let told = 0;
    session.subscribe(() => {
      told += 1;
    });
    session.setText("the evidence", true);
    session.observe(true);
    await tick();
    const toldBefore = told;
    await session.retire();
    answer({ fresh: true, purpose: null, purposeFailed: false });
    await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS * 3);
    expect(session.get().seeded).toBe(false);
    expect(s.saves()).toEqual([]);
    expect(s.reads()).toHaveLength(1);
    expect(told, "a retired session reached its listeners").toBe(toldBefore);
  });
});

describe("retiring", () => {
  it("sends the latest text to its own article, after the write in flight", async () => {
    const s = server();
    const session = await seeded(s);
    s.world.hold = true;
    session.setText("A", true);
    session.commit();
    session.setText("B", true);
    let retired = false;
    void session.retire().then(() => {
      retired = true;
    });
    await tick();
    expect(s.saves(), "the flush did not wait for the write in flight").toEqual([`save:${SLUG}:A`]);
    s.held[0]?.land();
    await tick();
    expect(s.saves()).toEqual([`save:${SLUG}:A`, `save:${SLUG}:B`]);
    expect(retired, "retired resolved before its flush had settled").toBe(false);
    s.held[1]?.land();
    await tick();
    expect(retired).toBe(true);
    expect(s.stored()).toBe("B");

    /* And it is deaf afterwards. */
    session.setText("C", true);
    session.commit();
    await tick();
    expect(s.saves()).toHaveLength(2);
  });

  it("sends nothing when the server already has the text, or the session never seeded", async () => {
    const s = server({ exists: false });
    const unseeded = new AddPurposeSession(SLUG, s.io);
    unseeded.observe(true);
    unseeded.setText("typed", true);
    await unseeded.retire();
    s.world.exists = true;
    const clean = await seeded(s, "another");
    clean.setText("kept", true);
    clean.commit();
    await tick();
    await clean.retire();
    expect(s.saves()).toEqual(["save:another:kept"]);
  });

  it("an abandoned draft is not sent behind the reader's back", async () => {
    const s = server();
    const session = await seeded(s);
    session.setText("declined", true);
    session.abandon();
    expect(session.get().unsaved).toBe(false);
    session.commit();
    session.leaveNow();
    await session.retire();
    expect(s.calls.filter((c) => !c.startsWith("read:"))).toEqual([]);
  });

  /* Sol's F9: two addresses, one article. The old session has A in flight and
     B behind it; the new one has C. C was typed last and must be stored last. */
  it("a second session for the same article waits for the first, and its text wins", async () => {
    const s = server();
    const old = await seeded(s);
    s.world.hold = true;
    old.setText("A", true);
    old.commit();
    old.setText("B", true);
    const readsBefore = s.reads().length;

    const next = new AddPurposeSession(SLUG, s.io, { after: old.retire() });
    next.observe(true);
    next.setText("C", true);
    next.commit();
    await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS * 3);
    expect(s.reads(), "the new session read while the old one still had writes to make").toHaveLength(
      readsBefore,
    );
    expect(s.saves()).toEqual([`save:${SLUG}:A`]);

    s.held[0]?.land();
    await tick();
    expect(s.saves()).toEqual([`save:${SLUG}:A`, `save:${SLUG}:B`]);
    expect(s.reads()).toHaveLength(readsBefore);
    s.held[1]?.land();
    await tick();
    expect(s.saves()).toEqual([`save:${SLUG}:A`, `save:${SLUG}:B`, `save:${SLUG}:C`]);
    s.held[2]?.land();
    await tick();
    expect(s.stored()).toBe("C");
    expect(next.get().state.kind).toBe("saved");
  });
});

describe("on the way out", () => {
  it("leaveNow sends the keepalive write at once, without waiting for a write in flight", async () => {
    const s = server();
    const session = await seeded(s);
    s.world.hold = true;
    session.setText("A", true);
    session.commit();
    session.setText("B", true);
    session.leaveNow();
    expect(s.calls.filter((c) => c.startsWith("leave:"))).toEqual([`leave:${SLUG}:B`]);
  });

  it("leaveNow sends nothing before the seed, or when nothing differs", async () => {
    const s = server({ exists: false });
    const unseeded = new AddPurposeSession(SLUG, s.io);
    unseeded.setText("typed", true);
    unseeded.leaveNow();
    s.world.exists = true;
    const clean = await seeded(s);
    clean.leaveNow();
    expect(s.calls.filter((c) => c.startsWith("leave:"))).toEqual([]);
  });
});

/**
 * **Paused while a dictation runs** — plan 261020r § Stage 2. Chromium's live
 * guesses arrive as ordinary keystrokes, so nothing saves by itself until the
 * dictation ends, and a stored purpose read meanwhile is held, not adopted.
 */
describe("paused while dictating", () => {
  /** A read the test answers when it chooses. */
  function heldRead(s: ReturnType<typeof server>) {
    let answer: (a: PurposeAnswer) => void = () => {};
    s.world.read = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    return (purpose: string | null) => answer({ fresh: true, purpose, purposeFailed: false });
  }

  it("a dirty box does not save after the pause while paused, and does once unpaused and still", async () => {
    const s = server();
    const session = await seeded(s);
    session.setPaused(true);
    session.setText("the rough live guess", true);
    await vi.advanceTimersByTimeAsync(ADD_PURPOSE_IDLE_MS * 5);
    expect(s.saves(), "the live guesses were saved by the idle timer").toEqual([]);
    expect(session.get().state.kind).toBe("dirty");

    session.setPaused(false);
    await tick();
    expect(s.saves(), "unpausing saved at once rather than after the pause").toEqual([]);
    await vi.advanceTimersByTimeAsync(ADD_PURPOSE_IDLE_MS);
    expect(s.saves()).toEqual([`save:${SLUG}:the rough live guess`]);
  });

  it("an idle timer already armed when the pause starts does not fire", async () => {
    const s = server();
    const session = await seeded(s);
    session.setText("typed, then the microphone", true);
    await vi.advanceTimersByTimeAsync(ADD_PURPOSE_IDLE_MS / 2);
    session.setPaused(true);
    await vi.advanceTimersByTimeAsync(ADD_PURPOSE_IDLE_MS * 3);
    expect(s.saves(), "the timer armed before the pause still fired").toEqual([]);
  });

  it("holds a read that answers while paused: a blank box does not take the stored text, and nothing is read again", async () => {
    const s = server({ stored: "why I came" });
    const answer = heldRead(s);
    const session = new AddPurposeSession(SLUG, s.io);
    session.setPaused(true);
    session.observe(true);
    await tick();
    expect(s.reads()).toHaveLength(1);
    answer("why I came");
    await tick();
    expect(session.get().text, "a stored purpose moved into the box under a live dictation").toBe("");
    expect(session.get().state.kind).toBe("loading");
    expect(session.get().seeded).toBe(false);
    expect(s.saves()).toEqual([]);

    /* Neither the page's observe nor completion starts a second read. */
    s.world.read = null;
    session.observe(true);
    session.observe(false);
    session.observe(true);
    session.completed();
    await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS * 5);
    expect(s.reads(), "read again over a held answer").toHaveLength(1);
    expect(s.saves()).toEqual([]);

    session.setPaused(false);
    await tick();
    expect(session.get().text).toBe("why I came");
    expect(session.get().state.kind).toBe("clean");
    expect(session.carried(), "the adopted text became the reader's").toBe("");
    expect(s.saves()).toEqual([]);
  });

  it("a typed box keeps its words over a held read, and commits them on unpause", async () => {
    const s = server({ stored: "why I came" });
    const answer = heldRead(s);
    const session = new AddPurposeSession(SLUG, s.io);
    session.setText("the methods", true);
    session.setPaused(true);
    session.observe(true);
    await tick();
    answer("why I came");
    await tick();
    session.setText("the methods and the live guess", true);
    await vi.advanceTimersByTimeAsync(ADD_PURPOSE_IDLE_MS * 3);
    expect(session.get().text).toBe("the methods and the live guess");
    expect(s.saves()).toEqual([]);

    session.setText("the methods and the transcript", true);
    session.setPaused(false);
    await tick();
    expect(s.saves()).toEqual([`save:${SLUG}:the methods and the transcript`]);
    expect(s.stored()).toBe("the methods and the transcript");
  });

  it("retired while paused over a held read: compares with the stored text, and never clears it", async () => {
    /* Blank box: nothing to send, and certainly not a clear. */
    const blank = server({ stored: "why I came" });
    const answerBlank = heldRead(blank);
    const a = new AddPurposeSession(SLUG, blank.io);
    a.setPaused(true);
    a.observe(true);
    await tick();
    answerBlank("why I came");
    await tick();
    await a.retire();
    expect(blank.saves(), "a retired blank box cleared a stored purpose").toEqual([]);
    expect(blank.stored()).toBe("why I came");

    /* The same words as stored: nothing to send. */
    const same = server({ stored: "why I came" });
    const answerSame = heldRead(same);
    const b = new AddPurposeSession(SLUG, same.io);
    b.setText("why I came", true);
    b.setPaused(true);
    b.observe(true);
    await tick();
    answerSame("why I came");
    await tick();
    await b.retire();
    expect(same.saves()).toEqual([]);

    /* Different words: the retired session still owes them to its article. */
    const typed = server({ stored: "why I came" });
    const answerTyped = heldRead(typed);
    const c = new AddPurposeSession(SLUG, typed.io);
    c.setText("the transcript", true);
    c.setPaused(true);
    c.observe(true);
    await tick();
    answerTyped("why I came");
    await tick();
    await c.retire();
    expect(typed.saves(), "words over a held read were lost at retire").toEqual([`save:${SLUG}:the transcript`]);
  });

  it("leaveNow while paused over a held read sends typed words, and nothing for a blank box", async () => {
    const s = server({ stored: "why I came" });
    const answer = heldRead(s);
    const typed = new AddPurposeSession(SLUG, s.io);
    typed.setText("the transcript", true);
    typed.setPaused(true);
    typed.observe(true);
    await tick();
    answer("why I came");
    await tick();
    typed.leaveNow();
    expect(s.calls.filter((c) => c.startsWith("leave:"))).toEqual([`leave:${SLUG}:the transcript`]);

    const t = server({ stored: "why I came" });
    const answerBlank = heldRead(t);
    const blank = new AddPurposeSession(SLUG, t.io);
    blank.setPaused(true);
    blank.observe(true);
    await tick();
    answerBlank("why I came");
    await tick();
    blank.leaveNow();
    expect(t.calls.filter((c) => c.startsWith("leave:"))).toEqual([]);
  });

  it("an explicit commit while paused still saves once seeded", async () => {
    const s = server();
    const session = await seeded(s);
    session.setPaused(true);
    session.setText("the transcript", true);
    session.commit();
    await tick();
    expect(s.saves()).toEqual([`save:${SLUG}:the transcript`]);
    expect(session.get().state.kind).toBe("saved");
  });
});

describe("what the page reads", () => {
  it("hands back the same snapshot until something changes, and tells its listeners when it does", async () => {
    const s = server();
    const session = new AddPurposeSession(SLUG, s.io, { text: "carried" });
    expect(session.get()).toBe(session.get());
    expect(session.get().text).toBe("carried");
    expect(session.carried()).toBe("carried");
    let told = 0;
    const stop = session.subscribe(() => {
      told += 1;
    });
    const before = session.get();
    session.setText("carried on", true);
    expect(told).toBe(1);
    expect(session.get()).not.toBe(before);
    stop();
    session.setText("again", true);
    expect(told).toBe(1);
  });
});


it("completion gives an exhausted probe a full short run, including transient failures", async () => {
  const s = server({ exists: false });
  const session = new AddPurposeSession(SLUG, s.io);
  session.setText("the evidence", true);
  session.observe(true);
  await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS * PURPOSE_READ_MAX_TRIES);
  expect(session.get().gaveUp).toBe(true);
  const before = s.reads().length;
  session.completed();
  await tick();
  expect(session.get().gaveUp, "completion allowed only one try after exhaustion").toBe(false);
  await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS * (PURPOSE_READ_FINAL_TRIES - 2));
  s.world.exists = true;
  await vi.advanceTimersByTimeAsync(PURPOSE_READ_RETRY_MS);
  expect(s.reads()).toHaveLength(before + PURPOSE_READ_FINAL_TRIES);
  expect(session.get().seeded).toBe(true);
  expect(s.stored()).toBe("the evidence");
});
