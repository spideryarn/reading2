// @vitest-environment jsdom
/**
 * **UNSENT DRAFTS** — `tools/fleet/web/src/drafts.ts`, the one hook all three
 * of the fleet dashboard's text boxes keep their words through.
 *
 * What is under test is a set of rules, not a storage wrapper, and each rule
 * has a way of being wrong that looks like working:
 *
 *  - **restore only under a verified conversation, into an untouched box** — a
 *    draft restored under a guess is a message addressed to one agent sitting in
 *    another agent's box;
 *  - **the box's text always wins** — a restore that overwrote typing is the
 *    page destroying words, which is the thing this exists to stop;
 *  - **write-through under the last verified conversation** — the unverifiable
 *    gap is the box's normal weather, and typing through it must not be lost
 *    or filed under the wrong conversation;
 *  - **words that may be meant for two conversations are kept on screen and
 *    never stored** — the fail-safe, until the box is empty again;
 *  - **storage that refuses** — Safari private mode throws on the accessor
 *    itself, a full quota throws on `setItem` — falls back to the page's memory
 *    and says so in one line.
 *
 * **Every test starts from an empty `sessionStorage` and an empty page memory**,
 * so one test's draft cannot satisfy another's assertion. A "reload" in this
 * file is `resetDraftPageStateForTests()` — the page's memory and its refusal
 * latch are what a reload forgets; `sessionStorage` is what it keeps.
 *
 * Conversation ids here are deliberately not uuids: tests/fixture-ids.test.ts
 * fails on any uuid shared between two test files, and nothing in this file
 * parses an id.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DRAFT_CAP,
  draftAddressOf,
  draftKey,
  draftNoticeSentence,
  resetDraftPageStateForTests,
  useDraft,
  type ConversationPurpose,
  type DraftAddress,
} from "../tools/fleet/web/src/drafts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

/* Through `window`, never the bare global: under jsdom the bare name is Node's
   own and reads undefined (src/web/install-hint.ts says so). */
const store = (): Storage => window.sessionStorage;

/**
 * **THE PROTOTYPE OF THE STORAGE THE PAGE ACTUALLY USES.** The bare `Storage`
 * global is Node's under jsdom too, so `vi.spyOn(Storage.prototype, …)` spies
 * on a class nothing here calls — which is how three tests in this file first
 * passed a spy that never fired. Every spy goes through this.
 */
const storageProto = (): Storage => Object.getPrototypeOf(window.sessionStorage) as Storage;

beforeEach(() => {
  store().clear();
  resetDraftPageStateForTests();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const A = "conv-alpha";
const B = "conv-bravo";
const KEY_A = draftKey("session-composer", A);
const KEY_B = draftKey("session-composer", B);

const verified = (id: string): DraftAddress => ({ kind: "verified", conversationId: id });
const CANNOT_TELL: DraftAddress = { kind: "cannot-tell" };

/** The smallest component that uses the hook the way a card does. */
function Box({
  address,
  scope = "mount-1",
  purpose = "session-composer",
}: {
  address: DraftAddress;
  scope?: string | null;
  purpose?: ConversationPurpose;
}) {
  const draft = useDraft({ purpose, address, scope });
  return (
    <div>
      <textarea aria-label="box" value={draft.text} onChange={(e) => draft.setText(e.target.value)} />
      <button type="button" onClick={draft.clear}>
        Clear
      </button>
      {draft.notice === null ? null : <p data-notice={draft.notice}>{draftNoticeSentence(draft.notice)}</p>}
    </div>
  );
}

function BroadcastBox() {
  const draft = useDraft({ purpose: "broadcast" });
  return (
    <div>
      <textarea aria-label="box" value={draft.text} onChange={(e) => draft.setText(e.target.value)} />
      <button type="button" onClick={draft.clear}>
        Clear
      </button>
      {draft.notice === null ? null : <p data-notice={draft.notice}>{draftNoticeSentence(draft.notice)}</p>}
    </div>
  );
}

function render(node: Parameters<Root["render"]>[0]): void {
  act(() => root.render(node));
}

/** Unmount and mount again in the same page — a session switch and back. */
function remount(node: Parameters<Root["render"]>[0]): void {
  act(() => root.unmount());
  root = createRoot(container);
  render(node);
}

/** What iOS does when it reclaims a tab: storage survives, the page's memory does not. */
function reload(node: Parameters<Root["render"]>[0]): void {
  act(() => root.unmount());
  resetDraftPageStateForTests();
  root = createRoot(container);
  render(node);
}

function box(): HTMLTextAreaElement {
  const el = container.querySelector("textarea");
  if (el === null) throw new Error("no textarea");
  return el;
}

function type(value: string): void {
  const input = box();
  act(() => {
    /* The React-controlled path: setting `.value` alone never reaches state. */
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clear(): void {
  const found = [...container.querySelectorAll("button")].find((b) => b.textContent === "Clear");
  if (found === undefined) throw new Error("no Clear button");
  act(() => found.click());
}

function notice(): string | null {
  return container.querySelector("[data-notice]")?.getAttribute("data-notice") ?? null;
}

function storedKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < store().length; i += 1) {
    const k = store().key(i);
    if (k !== null) keys.push(k);
  }
  return keys.sort();
}

describe("the key", () => {
  it("is purpose and conversation for the two addressed boxes, and purpose alone for the broadcast", () => {
    expect(draftKey("session-composer", "conv-x")).toBe("sy.draft.v1:session-composer:conv-x");
    expect(draftKey("overseer-message", "conv-x")).toBe("sy.draft.v1:overseer-message:conv-x");
    expect(draftKey("broadcast")).toBe("sy.draft.v1:broadcast");
  });

  it("keeps two purposes apart under one conversation", () => {
    render(<Box address={verified(A)} purpose="overseer-message" />);
    type("to the overseer");
    reload(<Box address={verified(A)} purpose="session-composer" />);
    expect(box().value).toBe("");
    expect(store().getItem(draftKey("overseer-message", A))).toBe("to the overseer");
  });
});

describe("restore — only under a verified conversation, only into an untouched box", () => {
  it("brings a draft back after a reload, and writes nothing but the typing under that one key", () => {
    render(<Box address={verified(A)} />);
    type("hello there");
    reload(<Box address={verified(A)} />);
    expect(box().value).toBe("hello there");
    // Nothing else is ever written: one key, and its value is the typing.
    expect(storedKeys()).toEqual([KEY_A]);
    expect(store().getItem(KEY_A)).toBe("hello there");
  });

  it("restores after a same-conversation relaunch — the key carries no process", () => {
    render(<Box address={verified(A)} scope="epoch-0" />);
    type("keep going");
    // A new process, so a new mount key; the same verified conversation.
    reload(<Box address={verified(A)} scope="epoch-1" />);
    expect(box().value).toBe("keep going");
  });

  it("restores nothing for a different verified conversation, and never reads the old draft", () => {
    store().setItem(KEY_A, "meant for alpha");
    const reads = vi.spyOn(storageProto(), "getItem");
    render(<Box address={verified(B)} />);
    expect(box().value).toBe("");
    const keysRead = reads.mock.calls.map((c) => c[0]);
    // The spy is live — it saw bravo's key being looked up — and alpha's was never read.
    expect(keysRead).toContain(KEY_B);
    expect(keysRead).not.toContain(KEY_A);
    expect(store().getItem(KEY_A)).toBe("meant for alpha");
  });

  it("restores nothing while the conversation cannot be told, then restores into the untouched box when it verifies", () => {
    store().setItem(KEY_A, "from before the reload");
    render(<Box address={CANNOT_TELL} />);
    expect(box().value).toBe("");
    render(<Box address={verified(A)} />);
    expect(box().value).toBe("from before the reload");
  });

  it("restores into a remounted box in the same page", () => {
    render(<Box address={verified(A)} />);
    type("switching away");
    remount(<Box address={verified(A)} />);
    expect(box().value).toBe("switching away");
  });
});

describe("the box's text always wins", () => {
  it("never overwrites typing with a stored draft, and persists the typing over it", () => {
    store().setItem(KEY_A, "an old draft");
    render(<Box address={CANNOT_TELL} />);
    type("something new");
    render(<Box address={verified(A)} />);
    expect(box().value).toBe("something new");
    expect(store().getItem(KEY_A)).toBe("something new");
  });

  it("does not restore into a box the person touched, even after emptying it", () => {
    /* An empty box is not an untouched one: somebody who typed during a gap
       and deleted it has made the box theirs, and a draft appearing in it
       when the conversation verifies would be words they did not put there. */
    store().setItem(KEY_A, "from before the reload");
    render(<Box address={CANNOT_TELL} />);
    type("x");
    type("");
    render(<Box address={verified(A)} />);
    expect(box().value).toBe("");
    // Never shown, so not the person's to have deleted: it stays for a later reload.
    expect(store().getItem(KEY_A)).toBe("from before the reload");
  });
});

describe("write-through, and the unverifiable gap", () => {
  it("persists typing during a gap under the last verified conversation, and under nothing else", () => {
    render(<Box address={verified(A)} />);
    type("one");
    render(<Box address={CANNOT_TELL} />);
    type("one two");
    expect(store().getItem(KEY_A)).toBe("one two");
    expect(storedKeys()).toEqual([KEY_A]);
  });

  it("keeps typing in memory when no conversation has been seen, and files it under the first one that verifies", () => {
    render(<Box address={CANNOT_TELL} />);
    type("typed blind");
    expect(storedKeys()).toEqual([]);
    render(<Box address={verified(A)} />);
    expect(store().getItem(KEY_A)).toBe("typed blind");
    expect(storedKeys()).toEqual([KEY_A]);
  });

  it("removes the stored draft when the person deletes every character", () => {
    render(<Box address={verified(A)} />);
    type("gone soon");
    type("");
    expect(store().getItem(KEY_A)).toBeNull();
  });
});

describe("one conversation's words are never filed under another's key", () => {
  it("keeps the words on screen and stops persisting when a different conversation verifies under one scope", () => {
    render(<Box address={verified(A)} />);
    type("for alpha");
    render(<Box address={verified(B)} />);
    expect(box().value).toBe("for alpha");
    type("for alpha, edited");
    expect(store().getItem(KEY_B)).toBeNull();
    expect(store().getItem(KEY_A)).toBe("for alpha");
  });

  it("files nothing from an old scope under a new scope's different conversation, and resumes once the box is empty", () => {
    render(<Box address={verified(A)} scope="overseer-row-1" />);
    type("to the first overseer");
    render(<Box address={verified(B)} scope="overseer-row-2" />);
    expect(box().value).toBe("to the first overseer");
    type("to the first overseer, still");
    expect(store().getItem(KEY_B)).toBeNull();
    clear();
    expect(store().getItem(KEY_A)).toBeNull();
    type("to the second overseer");
    expect(store().getItem(KEY_B)).toBe("to the second overseer");
  });

  it("does not bind blind typing from an old scope to the next scope's conversation", () => {
    render(<Box address={CANNOT_TELL} scope="overseer-row-1" />);
    type("typed blind at the first");
    render(<Box address={verified(B)} scope="overseer-row-2" />);
    expect(box().value).toBe("typed blind at the first");
    expect(storedKeys()).toEqual([]);
  });

  it("goes on persisting across a new scope when the conversation is the same one", () => {
    render(<Box address={verified(A)} scope="epoch-0" />);
    type("same conversation");
    render(<Box address={verified(A)} scope="epoch-1" />);
    type("same conversation, relaunched");
    expect(store().getItem(KEY_A)).toBe("same conversation, relaunched");
  });

  it("restores the new scope's own draft into a box left empty", () => {
    store().setItem(KEY_B, "waiting for bravo");
    render(<Box address={verified(A)} scope="overseer-row-1" />);
    render(<Box address={verified(B)} scope="overseer-row-2" />);
    expect(box().value).toBe("waiting for bravo");
  });

  it("a null scope preserves the last one rather than reading as a change", () => {
    render(<Box address={verified(A)} scope="overseer-row-1" />);
    type("steady");
    render(<Box address={CANNOT_TELL} scope={null} />);
    render(<Box address={verified(A)} scope="overseer-row-1" />);
    type("steady on");
    expect(store().getItem(KEY_A)).toBe("steady on");
  });
});

describe("hold — a fact says the pane is not the draft's recipient", () => {
  it("restores the named conversation's draft into an untouched box and never persists an edit", () => {
    store().setItem(KEY_A, "the claimed conversation's draft");
    render(<Box address={{ kind: "hold", restoreFrom: A }} />);
    expect(box().value).toBe("the claimed conversation's draft");
    type("the claimed conversation's draft, edited");
    expect(store().getItem(KEY_A)).toBe("the claimed conversation's draft");
    render(<Box address={CANNOT_TELL} />);
    type("and edited in a gap");
    expect(store().getItem(KEY_A)).toBe("the claimed conversation's draft");
    expect(storedKeys()).toEqual([KEY_A]);
  });

  it("stores nothing from the moment a hold arrives, even under a conversation already seen", () => {
    render(<Box address={verified(A)} />);
    type("a");
    render(<Box address={{ kind: "hold", restoreFrom: null }} />);
    // Kept on screen — never destroyed — and never written back.
    expect(box().value).toBe("a");
    type("a b");
    expect(store().getItem(KEY_A)).toBe("a");
    // Deleting every character under a hold writes nothing back either…
    type("");
    expect(store().getItem(KEY_A)).toBe("a");
    // …but Clear is the explicit gesture, and removes it.
    type("c");
    clear();
    expect(store().getItem(KEY_A)).toBeNull();
    expect(storedKeys()).toEqual([]);
  });
});

describe("Clear", () => {
  it("empties the box and removes the stored draft", () => {
    render(<Box address={verified(A)} />);
    type("never mind");
    clear();
    expect(box().value).toBe("");
    expect(store().getItem(KEY_A)).toBeNull();
    reload(<Box address={verified(A)} />);
    expect(box().value).toBe("");
  });

  it("removes a restored draft that was never edited", () => {
    store().setItem(KEY_A, "restored");
    render(<Box address={verified(A)} />);
    clear();
    expect(store().getItem(KEY_A)).toBeNull();
  });
});

describe("the cap", () => {
  it("stores text at the cap, and over it removes the stored copy, keeps the text and says so", () => {
    render(<Box address={verified(A)} />);
    const atCap = "x".repeat(DRAFT_CAP);
    type(atCap);
    expect(store().getItem(KEY_A)).toBe(atCap);
    expect(notice()).toBeNull();
    type(`${atCap}y`);
    // Not the older, shorter copy: that would come back after a reload as if it were the draft.
    expect(store().getItem(KEY_A)).toBeNull();
    expect(box().value).toBe(`${atCap}y`);
    expect(notice()).toBe("too-long");
    expect(container.textContent).toContain(draftNoticeSentence("too-long"));
  });

  it("stores again once the text is back under the cap", () => {
    render(<Box address={verified(A)} />);
    type("x".repeat(DRAFT_CAP + 1));
    type("short");
    expect(store().getItem(KEY_A)).toBe("short");
    expect(notice()).toBeNull();
  });
});

describe("storage that refuses", () => {
  it("survives an accessor that throws, keeps the words in memory for the page, and says so", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    render(<Box address={verified(A)} />);
    type("private mode");
    expect(box().value).toBe("private mode");
    expect(notice()).toBe("storage-refused");
    expect(container.textContent).toContain(draftNoticeSentence("storage-refused"));
    remount(<Box address={verified(A)} />);
    expect(box().value).toBe("private mode");
  });

  it("survives getItem throwing, and says so once there is something to lose", () => {
    store().setItem(KEY_A, "unreachable");
    vi.spyOn(storageProto(), "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    render(<Box address={verified(A)} />);
    expect(box().value).toBe("");
    type("typed anyway");
    expect(notice()).toBe("storage-refused");
  });

  it("survives a full quota on setItem, removes the older copy, and keeps the newer text in memory", () => {
    render(<Box address={verified(A)} />);
    type("first");
    expect(store().getItem(KEY_A)).toBe("first");
    vi.spyOn(storageProto(), "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    type("first and second");
    expect(store().getItem(KEY_A)).toBeNull();
    expect(box().value).toBe("first and second");
    expect(notice()).toBe("storage-refused");
    remount(<Box address={verified(A)} />);
    expect(box().value).toBe("first and second");
  });

  it("draws no line when storage works", () => {
    render(<Box address={verified(A)} />);
    type("fine");
    expect(notice()).toBeNull();
  });
});

describe("the broadcast box — keyed by purpose alone", () => {
  it("restores after a reload, with no conversation in the key, and Clear removes it", () => {
    render(<BroadcastBox />);
    type("to everybody");
    reload(<BroadcastBox />);
    expect(box().value).toBe("to everybody");
    expect(storedKeys()).toEqual([draftKey("broadcast")]);
    clear();
    expect(storedKeys()).toEqual([]);
  });

  it("applies the same cap", () => {
    render(<BroadcastBox />);
    type("y".repeat(DRAFT_CAP + 1));
    expect(storedKeys()).toEqual([]);
    expect(notice()).toBe("too-long");
  });
});

describe("draftAddressOf — which reading may key a draft", () => {
  const token = { boot: "drafts-boot", pid: 7001, startTicks: 12_345 };
  it("keys only a verified conversation on a verified execution", () => {
    expect(
      draftAddressOf({ kind: "verified", token, harness: "claude-code", conversation: { kind: "verified", id: A } }),
    ).toEqual(verified(A));
  });

  it("holds on a conflicting conversation, naming the claimed one to restore from", () => {
    expect(
      draftAddressOf({
        kind: "verified",
        token,
        harness: "claude-code",
        conversation: { kind: "conflicting", claimed: A, observed: B },
      }),
    ).toEqual({ kind: "hold", restoreFrom: A });
  });

  it("holds, restoring nothing, when no conversation was ever claimed", () => {
    expect(
      draftAddressOf({ kind: "verified", token, harness: "shell", conversation: { kind: "not-claimed" } }),
    ).toEqual({ kind: "hold", restoreFrom: null });
  });

  it("cannot tell for an unverifiable conversation, a claimed-only reading, and an unknown one", () => {
    expect(
      draftAddressOf({
        kind: "verified",
        token,
        harness: "claude-code",
        conversation: { kind: "unverifiable", claimed: A, why: "slow" },
      }),
    ).toEqual(CANNOT_TELL);
    expect(
      draftAddressOf({ kind: "claimed-only", conversation: { kind: "unverifiable", claimed: A, why: "x" }, why: "y" }),
    ).toEqual(CANNOT_TELL);
    expect(draftAddressOf({ kind: "unknown", cause: "not-probed", why: "z" })).toEqual(CANNOT_TELL);
  });
});
