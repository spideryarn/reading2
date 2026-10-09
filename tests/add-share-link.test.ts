/**
 * The add page's *Create a private link* — src/web/add-share-link.ts, plan
 * docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md
 * § Stage 2, 2b. Every answer of the probe, the read, the create and the
 * turn-off, driven through injected requests, as tests/add-share.test.ts does
 * for the public switch beside it.
 *
 * What differs from that switch, and is pinned here:
 *
 *  - **it reads the truth on every attachment** (`GET …/share-link` needs no
 *    published revision), so there is no mark: a fresh controller over a link
 *    that is on shows it;
 *  - **an answer to the create that did not come back is never sent again by
 *    itself** (GPT Sol's stage 2 plan review): a second create rotates the
 *    key. The state is *unknown*, and only a read or the reader's idempotent
 *    *Turn off* leaves it;
 *  - **a retired controller is dead** (F1): a reply that arrives for one
 *    changes nothing, and the key it held is gone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShareLinkState } from "../src/types.js";
import { MAX_NOT_YET } from "../src/web/add-high-power.js";
import type { Probe } from "../src/web/add-share.js";
import {
  LinkAtAdd,
  linkAtAddFor,
  type LinkIo,
  linkUnsettled,
} from "../src/web/add-share-link.js";
import { retireAddSharing } from "../src/web/add-sharing-session.js";

const SLUG = "an-essay";
const KEY = "AAAAAAAAAAAAAAAAAAAAAA";
const KEY_2 = "BBBBBBBBBBBBBBBBBBBBBB";
const AT = "2026-10-06T12:00:00.000Z";
const ON: ShareLinkState = { on: true, key: KEY, since: AT };
const ON_2: ShareLinkState = { on: true, key: KEY_2, since: AT };
const OFF: ShareLinkState = { on: false };

function refusal(status: number, message = "no"): Error {
  return Object.assign(new Error(message), { status });
}

type Read = ShareLinkState | "none" | null | Error;
type Write = ShareLinkState | null | Error | Promise<ShareLinkState | null>;

/** Requests whose answers the test sets, recording every one made. */
function scripted(first: Probe | Error, read: Read, ...writes: Write[]) {
  const now: { probe: Probe | Error; read: Read } = { probe: first, read };
  const calls: string[] = [];
  const write = async (name: string) => {
    calls.push(name);
    const next = writes.shift();
    if (next === undefined) throw new Error(`unscripted ${name}`);
    if (next instanceof Error) throw next;
    return next;
  };
  const io: LinkIo = {
    probe: async () => {
      calls.push("probe");
      if (now.probe instanceof Error) throw now.probe;
      return now.probe;
    },
    read: async () => {
      calls.push("read");
      if (now.read instanceof Error) throw now.read;
      return now.read;
    },
    create: () => write("create"),
    remove: () => write("remove"),
  };
  const made = () => calls.filter((c) => c === "create").length;
  return { io, calls, now, made };
}

/** A started link whose probe and read have answered. */
async function offered(io: LinkIo, retryMs = 10): Promise<LinkAtAdd> {
  const link = new LinkAtAdd(SLUG, io, retryMs);
  link.start();
  await vi.advanceTimersByTimeAsync(0);
  return link;
}

/** Open the confirmation, tick the rights, press *Create the link*. */
function confirm(link: LinkAtAdd): void {
  link.open();
  link.tick(true);
  link.create();
}

/** Leave the page and come back: every attachment after the first asks again. */
async function reattach(link: LinkAtAdd): Promise<void> {
  link.pause();
  link.start();
  link.resume();
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  retireAddSharing();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the read on attachment", () => {
  it("asks nothing until it is started, and then the probe and the read once each", async () => {
    const { io, calls } = scripted("none", "none");
    const link = new LinkAtAdd(SLUG, io);
    expect(calls).toEqual([]);
    expect(link.get()).toEqual({ kind: "reading" });
    link.start();
    link.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["probe", "read"]);
  });

  it("a 404 is *no row yet*: the control is offered, off", async () => {
    const link = await offered(scripted("none", "none").io);
    expect(link.get()).toEqual({ kind: "off" });
  });

  it("a row with no link is off", async () => {
    const link = await offered(scripted("none", OFF).io);
    expect(link.get()).toEqual({ kind: "off" });
  });

  it("a link that is on is shown, with no mark and no request sent: a reload, or a second tab", async () => {
    const { io, calls } = scripted("none", ON);
    const link = await offered(io);
    expect(link.get()).toEqual({ kind: "on", link: { key: KEY, since: AT } });
    expect(calls).toEqual(["probe", "read"]);
  });

  it("gives way over an article already on the shelf, and does not read", async () => {
    const { io, calls } = scripted("article", ON);
    const link = await offered(io);
    expect(link.get()).toEqual({ kind: "adopted" });
    expect(calls).toEqual(["probe"]);
    link.open();
    expect(link.get()).toEqual({ kind: "adopted" });
  });

  it.each([
    ["the probe could not say", "unknown" as Probe, "none" as Read],
    ["the probe failed", new Error("offline"), "none" as Read],
    ["the read failed", "none" as Probe, new Error("offline")],
    ["the read could not be understood", "none" as Probe, null],
  ])("offers nothing when %s", async (_name, probe, read) => {
    const { io, made } = scripted(probe, read);
    const link = await offered(io);
    expect(link.get()).toEqual({ kind: "unavailable" });
    confirm(link);
    await vi.runAllTimersAsync();
    expect(made()).toBe(0);
  });

  it("cannot be confirmed while the read is still out", () => {
    const { io, made } = scripted("none", "none");
    const link = new LinkAtAdd(SLUG, io);
    link.start();
    confirm(link);
    expect(link.get()).toEqual({ kind: "reading" });
    expect(made()).toBe(0);
  });
});

describe("the confirmation", () => {
  it("sends nothing on opening it, nor on the press without the rights box", async () => {
    const { io, made } = scripted("none", "none");
    const link = await offered(io);
    link.open();
    expect(link.get()).toEqual({ kind: "confirming", rights: false });
    link.create();
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "confirming", rights: false });
    expect(made()).toBe(0);
  });

  it("creates once, with the rights box ticked and the press, and shows the server's link", async () => {
    const { io, made } = scripted("none", OFF, ON);
    const link = await offered(io);
    confirm(link);
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "on", link: { key: KEY, since: AT } });
    expect(made()).toBe(1);
  });

  it("Cancel closes it without sending, and the rights box starts unticked next time", async () => {
    const { io, made } = scripted("none", "none");
    const link = await offered(io);
    link.open();
    link.tick(true);
    link.cancel();
    expect(link.get()).toEqual({ kind: "off" });
    link.open();
    expect(link.get()).toEqual({ kind: "confirming", rights: false });
    expect(made()).toBe(0);
  });
});

describe("before the article's row exists", () => {
  it("treats a 404 on the create as *not yet* while the job is alive, and retries", async () => {
    const { io, made } = scripted("none", "none", refusal(404), refusal(404), ON);
    const link = await offered(io);
    confirm(link);
    await vi.advanceTimersByTimeAsync(0);
    expect(link.get()).toEqual({ kind: "waiting" });
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "on", link: { key: KEY, since: AT } });
    expect(made()).toBe(3);
  });

  it("Cancel while waiting stops the retry and sends nothing more", async () => {
    const { io, made } = scripted("none", "none", refusal(404));
    const link = await offered(io);
    confirm(link);
    await vi.advanceTimersByTimeAsync(0);
    link.cancel();
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "off" });
    expect(made()).toBe(1);
  });

  it("gives up after five minutes of not yet, and `settle` sends it again", async () => {
    const writes: Write[] = Array.from({ length: MAX_NOT_YET + 1 }, () => refusal(404));
    const { io, made } = scripted("none", "none", ...writes, ON);
    const link = await offered(io, 1);
    confirm(link);
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "gave-up" });
    expect(made()).toBe(MAX_NOT_YET + 1);
    await link.settle();
    expect(link.get()).toEqual({ kind: "on", link: { key: KEY, since: AT } });
  });

  it("at completion sends a still-waiting create now, and a 404 is then final", async () => {
    const { io, made } = scripted("none", "none", refusal(404), refusal(404, "No such article"));
    const link = await offered(io, 60_000);
    confirm(link);
    await vi.advanceTimersByTimeAsync(0);
    expect(link.get()).toEqual({ kind: "waiting" });
    await link.settle();
    expect(link.get()).toEqual({ kind: "refused", message: "No such article", link: null, attempted: "on" });
    expect(made()).toBe(2);
  });

  it("`settle` sends nothing for a control never confirmed", async () => {
    const { io, made } = scripted("none", "none");
    const link = await offered(io);
    link.open();
    await link.settle();
    expect(made()).toBe(0);
  });

  it("stops its retries when its page leaves, and goes on when it is back", async () => {
    const { io, made } = scripted("none", "none", refusal(404), ON);
    const link = await offered(io);
    confirm(link);
    await vi.advanceTimersByTimeAsync(0);
    link.pause();
    await vi.runAllTimersAsync();
    expect(made()).toBe(1);
    link.resume();
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "on", link: { key: KEY, since: AT } });
  });

  it("keeps the request across a job that failed before its claim, and its Retry", async () => {
    const { io, made } = scripted("none", "none", refusal(404), refusal(404, "No such article"), ON);
    const link = await offered(io, 60_000);
    confirm(link);
    await vi.advanceTimersByTimeAsync(0);
    link.observe(false);
    await link.settle();
    expect(link.get().kind).toBe("refused");
    link.observe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(link.get()).toEqual({ kind: "on", link: { key: KEY, since: AT } });
    expect(made()).toBe(3);
  });
});

describe("an answer to the create that did not come back", () => {
  it.each([
    ["no answer", new TypeError("Failed to fetch") as Write],
    ["a server error", refusal(500, "boom") as Write],
    ["a success that cannot be read", null as Write],
  ])("after %s: unknown, and no second create by itself", async (_name, answer) => {
    const { io, made } = scripted("none", "none", answer);
    const link = await offered(io, 1);
    confirm(link);
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "unknown", because: "write", checking: false });
    await link.settle();
    link.observe(false);
    link.observe(true);
    await reattach(link);
    await vi.runAllTimersAsync();
    expect(made()).toBe(1);
  });

  it("*Check again* reads, and shows the link the create did make", async () => {
    const { io, calls, now, made } = scripted("none", "none", new TypeError("Failed to fetch"));
    const link = await offered(io);
    confirm(link);
    await vi.runAllTimersAsync();
    now.read = ON;
    const before = calls.length;
    link.recheck();
    expect(link.get()).toEqual({ kind: "unknown", because: "write", checking: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(link.get()).toEqual({ kind: "on", link: { key: KEY, since: AT } });
    expect(calls.slice(before)).toEqual(["read"]);
    expect(made()).toBe(1);
  });

  it("*Check again* that finds no link is off, and one that fails stays unknown", async () => {
    const { io, now } = scripted("none", "none", new TypeError("Failed to fetch"));
    const link = await offered(io);
    confirm(link);
    await vi.runAllTimersAsync();
    now.read = new Error("offline");
    link.recheck();
    await vi.advanceTimersByTimeAsync(0);
    expect(link.get()).toEqual({ kind: "unknown", because: "write", checking: false });
    now.read = OFF;
    link.recheck();
    await vi.advanceTimersByTimeAsync(0);
    expect(link.get()).toEqual({ kind: "off" });
  });

  it("the next attachment's read settles it too", async () => {
    const { io, now, made } = scripted("none", "none", new TypeError("Failed to fetch"));
    const link = await offered(io);
    confirm(link);
    await vi.runAllTimersAsync();
    now.read = ON;
    await reattach(link);
    expect(link.get()).toEqual({ kind: "on", link: { key: KEY, since: AT } });
    expect(made()).toBe(1);
  });
});

/**
 * Plan 261009l. A link that may be live must be possible to turn off from
 * the page that made it, even while every read fails: the turn-off is
 * idempotent on the server, so sending it from `unknown` is safe.
 */
describe("*Turn off* from not knowing", () => {
  /** A create whose reply was lost, and reads that now fail too. */
  async function lostCreate(...writes: Write[]) {
    const s = scripted("none", "none", new TypeError("Failed to fetch"), ...writes);
    const link = await offered(s.io);
    confirm(link);
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "unknown", because: "write", checking: false });
    s.now.read = new Error("offline");
    link.recheck();
    await vi.advanceTimersByTimeAsync(0);
    expect(link.get()).toEqual({ kind: "unknown", because: "write", checking: false });
    return { ...s, link };
  }

  it("sends one delete and is off, with no second create", async () => {
    const { link, calls, made } = await lostCreate(OFF);
    const before = calls.length;
    link.turnOff();
    expect(link.get()).toEqual({ kind: "saving", to: "off" });
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "off" });
    expect(calls.slice(before)).toEqual(["remove"]);
    expect(made()).toBe(1);
  });

  it("works the same after a turn-off whose reply was lost", async () => {
    const { io, calls } = scripted("none", ON, new TypeError("Failed to fetch"), OFF);
    const link = await offered(io);
    link.turnOff();
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "unknown", because: "write", checking: false });
    link.turnOff();
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "off" });
    expect(calls.filter((c) => c === "remove")).toHaveLength(2);
  });

  it("works after a failed read on coming back over a link that was on", async () => {
    const { io, now } = scripted("none", ON, OFF);
    const link = await offered(io);
    now.read = new Error("offline");
    await reattach(link);
    expect(link.get()).toEqual({ kind: "unknown", because: "read", checking: false });
    link.turnOff();
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "off" });
  });

  it("a 404 is off: the reader owns no row here, and the key lives on the row", async () => {
    const { link } = await lostCreate(refusal(404, "No article artefacts"));
    link.turnOff();
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "off" });
  });

  it("a 404 from a link drawn as on is off too: a key on screen that opens nothing is not shown", async () => {
    const { io } = scripted("none", ON, refusal(404, "No article artefacts"));
    const link = await offered(io);
    link.turnOff();
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "off" });
  });

  it.each([
    ["no answer", new TypeError("Failed to fetch") as Write],
    ["a server error", refusal(500, "boom") as Write],
    ["a success that cannot be read", null as Write],
    ["a refusal, which wrote nothing", refusal(403, "Not yours") as Write],
    ["signed out", refusal(401, "Sign in") as Write],
  ])("after %s it still does not know, and offers nothing to create", async (_name, answer) => {
    const { link, calls, made } = await lostCreate(answer);
    const before = calls.length;
    link.turnOff();
    expect(link.get()).toEqual({ kind: "saving", to: "off" });
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "unknown", because: "write", checking: false });
    expect(calls.slice(before)).toEqual(["remove"]);
    link.open();
    expect(link.get().kind).toBe("unknown");
    expect(made()).toBe(1);
  });

  it("a refusal after a failed attachment read keeps that reason and does not offer a create", async () => {
    const { io, now, calls, made } = scripted("none", ON, refusal(403, "Not yours"));
    const link = await offered(io);
    now.read = new Error("offline");
    await reattach(link);
    expect(link.get()).toEqual({ kind: "unknown", because: "read", checking: false });
    const before = calls.length;
    link.turnOff();
    expect(link.get()).toEqual({ kind: "saving", to: "off" });
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "unknown", because: "read", checking: false });
    expect(calls.slice(before)).toEqual(["remove"]);
    link.open();
    expect(link.get()).toEqual({ kind: "unknown", because: "read", checking: false });
    expect(made()).toBe(0);
  });

  it("pressed while *Check again*'s read is out, the read's late answer does not overwrite it", async () => {
    let readBack: (read: ShareLinkState) => void = () => {};
    const { link, io } = await lostCreate(OFF);
    io.read = () => new Promise((resolve) => (readBack = resolve));
    link.recheck();
    expect(link.get()).toEqual({ kind: "unknown", because: "write", checking: true });
    link.turnOff();
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "off" });
    readBack(ON);
    await vi.advanceTimersByTimeAsync(0);
    expect(link.get()).toEqual({ kind: "off" });
  });

  it.each([
    ["before", true],
    ["after", false],
  ])("a reattachment's read answering %s the turn-off does not overwrite it", async (_when, readFirst) => {
    let readBack: (read: ShareLinkState) => void = () => {};
    let removed: (state: ShareLinkState) => void = () => {};
    const { link, io, made } = await lostCreate();
    io.read = () => new Promise((resolve) => (readBack = resolve));
    io.remove = () => new Promise((resolve) => (removed = resolve));
    link.pause();
    link.resume();
    await vi.advanceTimersByTimeAsync(0);
    link.turnOff();
    if (readFirst) {
      readBack(ON);
      await vi.advanceTimersByTimeAsync(0);
      removed(OFF);
    } else {
      removed(OFF);
      await vi.advanceTimersByTimeAsync(0);
      readBack(ON);
    }
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "off" });
    expect(made()).toBe(1);
  });

  it("gives way if the reattachment finds the article published while the turn-off is out", async () => {
    let removed: (state: ShareLinkState) => void = () => {};
    let removes = 0;
    const { link, io, now } = await lostCreate();
    io.remove = () => {
      removes += 1;
      return new Promise((resolve) => (removed = resolve));
    };
    now.probe = "article";
    link.turnOff();
    expect(link.get()).toEqual({ kind: "saving", to: "off" });
    link.pause();
    link.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(link.get()).toEqual({ kind: "adopted" });
    expect(removes).toBe(1);
    removed(OFF);
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "adopted" });
  });
});

describe("the server's other answers", () => {
  it("shows a refusal in the server's sentence, and nothing is on", async () => {
    const { io } = scripted("none", OFF, refusal(409, "This paper has not been read through yet."));
    const link = await offered(io);
    confirm(link);
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({
      kind: "refused",
      message: "This paper has not been read through yet.",
      link: null,
      attempted: "on",
    });
    link.open();
    expect(link.get()).toEqual({ kind: "confirming", rights: false });
  });

  it("*Turn off* sends the delete, with no confirmation", async () => {
    const { io, calls } = scripted("none", ON, OFF);
    const link = await offered(io);
    link.turnOff();
    expect(link.get()).toEqual({ kind: "saving", to: "off" });
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "off" });
    expect(calls.filter((c) => c === "remove")).toHaveLength(1);
  });

  it("keeps the link on screen when turning it off is refused, and can ask again", async () => {
    const { io } = scripted("none", ON, refusal(403, "Not yours"), OFF);
    const link = await offered(io);
    link.turnOff();
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({
      kind: "refused",
      message: "Not yours",
      link: { key: KEY, since: AT },
      attempted: "off",
    });
    link.turnOff();
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "off" });
  });

  it("a turn-off that did not come back draws no link", async () => {
    const { io } = scripted("none", ON, new TypeError("Failed to fetch"));
    const link = await offered(io);
    link.turnOff();
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "unknown", because: "write", checking: false });
  });
});

describe("attached to a page again, it reads first", () => {
  it("keeps a create's answer when a reattachment read taken before it arrives later", async () => {
    let created: (state: ShareLinkState) => void = () => {};
    let readBack: (state: ShareLinkState) => void = () => {};
    const { io } = scripted("none", "none",
      new Promise<ShareLinkState>((resolve) => { created = resolve; }));
    const link = await offered(io);
    confirm(link);
    link.pause();
    io.read = () => new Promise<ShareLinkState>((resolve) => { readBack = resolve; });
    link.resume();
    await vi.advanceTimersByTimeAsync(0);
    created(ON);
    await vi.advanceTimersByTimeAsync(0);
    readBack(OFF);
    await vi.advanceTimersByTimeAsync(0);
    expect(link.get()).toEqual({ kind: "on", link: { key: KEY, since: AT } });
  });

  it("keeps a turn-off's answer when an older reattachment read arrives later", async () => {
    let readBack: (state: ShareLinkState) => void = () => {};
    const { io } = scripted("none", ON, OFF);
    const link = await offered(io);
    link.pause();
    io.read = () => new Promise<ShareLinkState>((resolve) => { readBack = resolve; });
    link.resume();
    await vi.advanceTimersByTimeAsync(0);
    link.turnOff();
    await vi.advanceTimersByTimeAsync(0);
    readBack(ON);
    await vi.advanceTimersByTimeAsync(0);
    expect(link.get()).toEqual({ kind: "off" });
  });

  it("on, then the article published: gives way to Metadata", async () => {
    const { io, now } = scripted("none", "none", ON);
    const link = await offered(io);
    confirm(link);
    await vi.runAllTimersAsync();
    now.probe = "article";
    await reattach(link);
    expect(link.get()).toEqual({ kind: "adopted" });
  });

  it("waiting, then the article published: no create, ever", async () => {
    const { io, now, made } = scripted("none", "none", refusal(404), ON);
    const link = await offered(io, 60_000);
    confirm(link);
    await vi.advanceTimersByTimeAsync(0);
    expect(made()).toBe(1);
    link.pause();
    now.probe = "article";
    link.resume();
    await link.settle();
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "adopted" });
    expect(made()).toBe(1);
  });

  it("shows the key the server has now, not the one it held: rotated elsewhere", async () => {
    const { io, now } = scripted("none", ON);
    const link = await offered(io);
    now.read = ON_2;
    await reattach(link);
    expect(link.get()).toEqual({ kind: "on", link: { key: KEY_2, since: AT } });
  });

  it("is off when the link was turned off elsewhere", async () => {
    const { io, now } = scripted("none", ON);
    const link = await offered(io);
    now.read = OFF;
    await reattach(link);
    expect(link.get()).toEqual({ kind: "off" });
  });

  it("does not create over a link made elsewhere while this one was waiting", async () => {
    const { io, now, made } = scripted("none", "none", refusal(404));
    const link = await offered(io, 60_000);
    confirm(link);
    await vi.advanceTimersByTimeAsync(0);
    now.read = ON_2;
    await reattach(link);
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "on", link: { key: KEY_2, since: AT } });
    expect(made()).toBe(1);
  });

  it("a waiting create is sent only after the read has answered", async () => {
    let release: (found: Probe) => void = () => {};
    const { io, made } = scripted("none", "none", refusal(404), ON);
    const link = await offered(io, 60_000);
    confirm(link);
    await vi.advanceTimersByTimeAsync(0);
    link.pause();
    io.probe = () => new Promise<Probe>((resolve) => { release = resolve; });
    link.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(made()).toBe(1);
    release("none");
    await vi.advanceTimersByTimeAsync(0);
    expect(link.get()).toEqual({ kind: "on", link: { key: KEY, since: AT } });
    expect(made()).toBe(2);
  });

  it("when the read fails, draws no link it could not read again", async () => {
    const { io, now } = scripted("none", ON);
    const link = await offered(io);
    now.read = new Error("offline");
    await reattach(link);
    expect(link.get()).toEqual({ kind: "unknown", because: "read", checking: false });
  });

  it("StrictMode's mount, unmount, mount asks once and is not left stuck", async () => {
    const { io, calls, made } = scripted("none", "none", ON);
    const link = new LinkAtAdd(SLUG, io);
    link.start();
    link.resume();
    link.pause();
    link.start();
    link.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["probe", "read"]);
    expect(link.get()).toEqual({ kind: "off" });
    confirm(link);
    await vi.runAllTimersAsync();
    expect(made()).toBe(1);
    expect(link.get().kind).toBe("on");
  });
});

describe("one controller per reader and slug, and a retired one is dead (F1)", () => {
  it("hands back the same controller for the same reader and slug", () => {
    const { io } = scripted("none", "none");
    expect(linkAtAddFor(SLUG, io, "reader-a")).toBe(linkAtAddFor(SLUG, io, "reader-a"));
    expect(linkAtAddFor("another", io, "reader-a")).not.toBe(linkAtAddFor(SLUG, io, "reader-a"));
  });

  it("gives another reader their own for the same slug, starting from nothing", async () => {
    const a = scripted("none", ON);
    const forA = linkAtAddFor(SLUG, a.io, "reader-a");
    forA.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(forA.get().kind).toBe("on");
    const forB = linkAtAddFor(SLUG, scripted("none", "none").io, "reader-b");
    expect(forB).not.toBe(forA);
    expect(forB.get()).toEqual({ kind: "reading" });
  });

  it("a session change empties the registry and drops the key the old controller held", async () => {
    const { io } = scripted("none", ON);
    const before = linkAtAddFor(SLUG, io, "reader-a");
    before.start();
    await vi.advanceTimersByTimeAsync(0);
    const seen: string[] = [];
    before.subscribe(() => seen.push(before.get().kind));
    retireAddSharing();
    expect(before.get()).toEqual({ kind: "reading" });
    expect(JSON.stringify(before.get())).not.toContain(KEY);
    expect(seen).toEqual(["reading"]);
    expect(linkAtAddFor(SLUG, io, "reader-a")).not.toBe(before);
  });

  it("a create answered after its controller was retired changes nothing and tells nobody", async () => {
    let answer: (state: ShareLinkState) => void = () => {};
    const pending = new Promise<ShareLinkState | null>((resolve) => { answer = resolve; });
    const { io } = scripted("none", "none", pending);
    const link = linkAtAddFor(SLUG, io, "reader-a");
    link.start();
    await vi.advanceTimersByTimeAsync(0);
    confirm(link);
    expect(link.get()).toEqual({ kind: "saving", to: "on" });
    retireAddSharing();
    const told = vi.fn();
    link.subscribe(told);
    answer(ON);
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "reading" });
    expect(told).not.toHaveBeenCalled();
  });

  it("a read answered after its controller was retired changes nothing", async () => {
    let answer: (found: Probe) => void = () => {};
    const { io } = scripted("none", ON);
    io.probe = () => new Promise<Probe>((resolve) => { answer = resolve; });
    const link = linkAtAddFor(SLUG, io, "reader-a");
    link.start();
    retireAddSharing();
    answer("none");
    await vi.runAllTimersAsync();
    expect(link.get()).toEqual({ kind: "reading" });
  });

  it("a retired controller does nothing when pressed", async () => {
    const { io, made, calls } = scripted("none", "none");
    const link = await offered(io);
    link.retire();
    calls.length = 0;
    link.start();
    link.resume();
    confirm(link);
    link.recheck();
    await link.settle();
    await vi.runAllTimersAsync();
    expect(calls).toEqual([]);
    expect(made()).toBe(0);
  });
});

describe("linkUnsettled — what holds the add page from leaving by itself", () => {
  it("holds for an open confirmation and every answer the reader has not read", () => {
    expect(linkUnsettled({ kind: "confirming", rights: false })).toBe(true);
    expect(linkUnsettled({ kind: "waiting" })).toBe(true);
    expect(linkUnsettled({ kind: "saving", to: "on" })).toBe(true);
    expect(linkUnsettled({ kind: "refused", message: "no", link: null, attempted: "on" })).toBe(true);
    expect(linkUnsettled({ kind: "gave-up" })).toBe(true);
    expect(linkUnsettled({ kind: "unknown", because: "write", checking: false })).toBe(true);
  });

  it("does not hold for a control never touched, or a link that is on", () => {
    expect(linkUnsettled({ kind: "reading" })).toBe(false);
    expect(linkUnsettled({ kind: "adopted" })).toBe(false);
    expect(linkUnsettled({ kind: "unavailable" })).toBe(false);
    expect(linkUnsettled({ kind: "off" })).toBe(false);
    expect(linkUnsettled({ kind: "on", link: { key: KEY, since: AT } })).toBe(false);
  });
});
