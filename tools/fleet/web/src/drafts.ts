/**
 * **UNSENT DRAFTS — WHAT A PERSON TYPED AND HAS NOT SENT, KEPT THROUGH A
 * RELOAD, AND NEVER RESTORED FOR SOMEBODY ELSE.**
 *
 * On a phone the page is reloaded every time iOS reclaims the tab, and a
 * half-written message to an agent goes with it. That is the one thing this
 * file fixes. Everything else in it is about not fixing it *wrongly*: a draft
 * that comes back in front of a different agent than the one it was written
 * for is worse than a draft that is lost, because it gets sent.
 *
 * docs/plans/260910c-session-continuity-protect-drafts-and-keep-context-current.md
 * § Stage 2 is the design; this header says what the code holds itself to.
 *
 * ## Keyed by the verified conversation, not by the process or the pane
 *
 * `sy.draft.v1:<purpose>:<conversation id>`. A draft is addressed to a
 * conversation. Keying it by the execution token would drop typed work on a
 * same-conversation relaunch, where the recipient has not changed; keying it by
 * the tmux handle would hand it to whatever conversation is in that pane next.
 * `purpose` is in the key so that two boxes on one screen can never share one.
 *
 * The broadcast box is the exception, keyed by purpose alone — see
 * BroadcastCard.tsx for why.
 *
 * ## sessionStorage only
 *
 * Per tab, gone when the tab is closed, and it survives the reload iOS forces.
 * localStorage — a draft that outlives the tab — is not built, and whether to
 * build it is Greg's decision; the plan's § Not built says what it would cost.
 *
 * ## The rules, which are the design
 *
 *  1. **Restore only under a verified conversation, and only into an untouched
 *     box.** A reload during an unverifiable collection restores nothing; if the
 *     conversation then verifies and the box is still untouched, it restores
 *     then.
 *  2. **The box's text always wins.** Nothing read from storage ever replaces
 *     something the person has typed.
 *  3. **Write-through on every change** — under the verified conversation if
 *     there is one, otherwise under the last verified conversation seen in this
 *     scope, otherwise in memory only. Text typed before any conversation was
 *     seen is filed under the first one that verifies.
 *  4. **Words that may be meant for two conversations are kept on screen and
 *     never stored**, until the box is empty again. See `Owner`.
 *  5. **Clear** empties the box and removes the stored copy; so does a
 *     successful Send or Queue, which calls the same thing.
 *
 * ## Storage that refuses
 *
 * Safari's private mode throws on the *accessor* — `window.sessionStorage`
 * itself — and not only on a write; a full quota throws `QuotaExceededError`
 * on `setItem`; blocked site data can throw on `getItem`. Every touch is
 * wrapped. The first refusal latches the page into keeping drafts in memory for
 * the rest of its life, and every box then says, in one line, that its message
 * will not survive a reload — a sentence that changes what you would do in the
 * next ten seconds, which is the bar SessionDetail.tsx sets for anything drawn
 * permanently.
 *
 * **Always `window.sessionStorage`, never the bare global.** Under jsdom the
 * bare name is Node's own and reads `undefined`, which is how a guard passes
 * its tests and fails in a browser (src/web/install-hint.ts, the same accident).
 *
 * ## What is stored, and what is not
 *
 * The person's own typing, as it is in the box, and nothing else: no
 * transcript, no server payload, no identifier beyond the key. Capped at
 * `DRAFT_CAP`, so a pasted transcript can neither fill the quota nor sit in
 * storage.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { isAddressableHarness } from "../../execution-token.js";
import type { ExecutionReading } from "../../wire.js";

/**
 * **The most a stored draft may be: 8,192 characters**, as `String.length`
 * counts them (UTF-16 code units).
 *
 * Longer than any message worth typing into an agent's box by hand, and far
 * short of a quota. Over it, the stored copy is *removed* rather than left at
 * its last shorter length — an older, shorter copy restored after a reload
 * would look like the draft and be missing its end — and the text stays in the
 * page's memory, with the one line saying so.
 */
export const DRAFT_CAP = 8192;

const PREFIX = "sy.draft.v1";

/** The two boxes addressed to one conversation. */
export type ConversationPurpose = "session-composer" | "overseer-message";
/** Every box that keeps a draft. A new one is a new member, never a shared key. */
export type DraftPurpose = ConversationPurpose | "broadcast";

export function draftKey(purpose: "broadcast"): string;
export function draftKey(purpose: ConversationPurpose, conversationId: string): string;
export function draftKey(purpose: DraftPurpose, conversationId?: string): string {
  return conversationId === undefined ? `${PREFIX}:${purpose}` : `${PREFIX}:${purpose}:${conversationId}`;
}

/* ------------------------------------------------------------------ *
 * THE STORE. Every touch of sessionStorage is in these four functions.
 * ------------------------------------------------------------------ */

/**
 * **Set once any touch of storage has thrown, and never unset** — the page
 * keeps drafts in memory from then on. Module state because it is a fact about
 * the page, not about one box: a browser that refused one box's write will
 * refuse the next box's too.
 */
let refused = false;

/**
 * The page's own copy, for what storage would not take: everything once
 * `refused` is set, and an over-cap draft always. Read before storage, so a
 * remount within the page — a session switch and back — finds it. A reload
 * empties it, which is the whole of what "will not survive a reload" means.
 */
const memory = new Map<string, string>();

/**
 * Text that cannot yet be filed under a verified conversation. Unlike
 * `memory`, these entries have no storage key and deliberately die with the
 * page. They exist only so a keyed detail-pane remount cannot silently eat
 * words typed while the pane was unverifiable.
 */
const unplaced = new Map<string, { text: string; scope: string | null }>();

/**
 * Edit generations live outside a mount because a request may finish after the
 * mount that began it has gone. A generation, not text equality, catches an
 * edit that changes A to B and back to A while the request is in flight.
 *
 * Two kinds of counter share the map. `page:<box>` is the box's: it moves on
 * every change the person makes to that box, and decides whether an answer may
 * clear what is on screen. `stored:<key>` is the stored key's: it moves
 * whenever any box decides to write or remove that key, and decides whether an
 * answer may take its words out of storage. The broadcast has no page key, so
 * its box counter *is* its stored key's, and the two rules are one rule there.
 */
const versions = new Map<string, number>();
const acceptedSubmissions = new Set<(submission: DraftSubmission) => void>();

function versionOf(key: string): number {
  return versions.get(key) ?? 0;
}

function advanceVersion(key: string): void {
  versions.set(key, versionOf(key) + 1);
}

function storedVersionKey(key: string): string {
  return `stored:${key}`;
}

function storage(): Storage | null {
  try {
    /* Some browsers with storage disabled answer null rather than throwing. */
    const s = window.sessionStorage as Storage | null | undefined;
    if (s === null || s === undefined) {
      refused = true;
      return null;
    }
    return s;
  } catch {
    refused = true;
    return null;
  }
}

function readStored(key: string): string | null {
  const held = memory.get(key);
  if (held !== undefined) return held;
  const s = storage();
  if (s === null) return null;
  try {
    return s.getItem(key);
  } catch {
    refused = true;
    return null;
  }
}

/**
 * **Removes the stored copy, best effort.** Called wherever a newer text could
 * not be stored, so an older one cannot come back after a reload as though it
 * were the draft.
 */
function dropStored(key: string): void {
  const s = storage();
  if (s === null) return;
  try {
    s.removeItem(key);
  } catch {
    refused = true;
  }
}

function put(key: string, text: string): void {
  if (text.length <= DRAFT_CAP && !refused) {
    const s = storage();
    if (s !== null) {
      try {
        s.setItem(key, text);
        memory.delete(key);
        return;
      } catch {
        /* QuotaExceededError, or storage blocked outright. */
        refused = true;
      }
    }
  }
  memory.set(key, text);
  dropStored(key);
}

function remove(key: string): void {
  memory.delete(key);
  dropStored(key);
}

/**
 * **What a reload forgets**: the page's memory and its refusal latch.
 * sessionStorage is what a reload keeps, so this does not touch it. For tests.
 */
export function resetDraftPageStateForTests(): void {
  refused = false;
  memory.clear();
  unplaced.clear();
  versions.clear();
}

/* ------------------------------------------------------------------ *
 * WHICH READING MAY KEY A DRAFT.
 * ------------------------------------------------------------------ */

/**
 * Where the box's words may be kept, as its caller knows it right now.
 *
 *  - `verified` — the conversation in the pane is known: restore its draft into
 *    an untouched box, and keep typing under it.
 *  - `cannot-tell` — no new fact has arrived. Restore nothing; keep typing under
 *    the last conversation this scope verified, if there was one.
 *  - `hold` — a fact has arrived saying the pane is *not* where these words were
 *    going (a conflicting conversation, or none at all). Store nothing from
 *    here. `restoreFrom` names a conversation whose draft may be put back into
 *    an untouched box so it is not silently removed from view — never stored
 *    again from this box. `null` restores nothing.
 */
export type DraftAddress =
  | { kind: "verified"; conversationId: string }
  | { kind: "cannot-tell" }
  | { kind: "hold"; restoreFrom: string | null };

const CANNOT_TELL: DraftAddress = { kind: "cannot-tell" };

/**
 * **THE ONE MAPPING FROM AN EXECUTION READING TO A DRAFT ADDRESS**, so the
 * session composer and the Overseer card cannot drift apart on it.
 *
 * `conflicting` names the *claimed* conversation to restore from: the reading
 * always arrives with a new process, so the session composer has just been
 * remounted empty, and the draft the person was writing is stored under the
 * claim (plan § Stage 2, "How that meets Stage 1's remount"). A caller whose
 * Send stays live under `conflicting` should drop `restoreFrom` rather than put
 * that draft in front of a live button.
 *
 * Only `verified` executions can say anything: `claimed-only`'s conversation
 * can only be `not-claimed` or `unverifiable` (wire.ts says why), and `unknown`
 * carries none.
 */
export function draftAddressOf(reading: ExecutionReading): DraftAddress {
  if (reading.kind !== "verified") return CANNOT_TELL;
  const conversation = reading.conversation;
  switch (conversation.kind) {
    case "verified":
      /* The browser's parser already downgrades a verified conversation on a
         harness that cannot hold one; asked again here because this function
         takes a reading, not a parsed row. */
      return isAddressableHarness(reading.harness)
        ? { kind: "verified", conversationId: conversation.id }
        : { kind: "hold", restoreFrom: null };
    case "conflicting":
      return { kind: "hold", restoreFrom: conversation.claimed };
    case "not-claimed":
      return { kind: "hold", restoreFrom: null };
    case "unverifiable":
      return CANNOT_TELL;
    default: {
      const never: never = conversation;
      return never;
    }
  }
}

/* ------------------------------------------------------------------ *
 * THE HOOK.
 * ------------------------------------------------------------------ */

/** Why the box's words will not survive a reload, when that is worth one line. */
export type DraftNotice = "storage-refused" | "too-long";

/**
 * The one line, in one place, so all three boxes say the same thing. Short
 * because it sits beside Clear, and it says what will happen rather than what
 * went wrong: the thing to do about it is finish the message now.
 */
export function draftNoticeSentence(notice: DraftNotice): string {
  switch (notice) {
    case "storage-refused":
      return "This browser will not let the page keep a copy, so a reload would lose this message.";
    case "too-long":
      return "Too long to keep a copy of, so a reload would lose this message.";
    default: {
      const never: never = notice;
      return never;
    }
  }
}

/** The fail-safe line when a pane moved while its old recipient's words remain. */
export const DRAFT_RECIPIENT_CHANGED_SENTENCE =
  "These words were typed for the previous recipient. Clear them, or copy them before writing a new message.";

/**
 * The broadcast takes no address and no scope, and the types say so: there is
 * no conversation for it to be addressed to.
 *
 * **`scope`** is the caller's word for *the same recipient, as far as this
 * mount can know*. The session composer is remounted whenever its process is
 * replaced (continuity.ts), so for it a scope never changes. The Overseer card
 * is not — it stays mounted while the Overseer moves to another row or another
 * process underneath it — so it passes `useExecutionEpoch`'s key for the
 * Overseer's row. A change of scope forgets which conversation the scope last
 * verified. `null` means *no recipient is resolved right now* and preserves the
 * last scope, the same way an unverifiable reading preserves an epoch.
 */
export type UseDraftArgs =
  | { purpose: ConversationPurpose; address: DraftAddress; pageSlot: string; scope?: string | null }
  | { purpose: "broadcast" };

export type Draft = {
  text: string;
  /** Every change the person makes — typing, dictation, pasting. Never a restore. */
  setText(next: string): void;
  /** Clear, and what a successful Send or Queue calls: empties the box and removes the stored copy. */
  clear(): void;
  /** Snapshot the exact draft generation a request is about to submit. */
  submission(): DraftSubmission | null;
  /** Accept a successful request: its words leave storage and the box, and nothing typed since does. */
  accept(submission: DraftSubmission): void;
  /** False when the words on screen pre-date a resolved recipient change. */
  canSubmit: boolean;
  /** Non-null when the words on screen will not survive a reload. */
  notice: DraftNotice | null;
};

/** Opaque outside this module: callers may only return it to `Draft.accept`. */
export type DraftSubmission = {
  readonly text: string;
  readonly versionKey: string;
  readonly version: number;
  /** The key the submitted words were stored under, and that key's write generation when they were submitted. */
  readonly filed: { readonly key: string; readonly version: number } | null;
  readonly pageKey: string | null;
};

/**
 * **WHO THE WORDS IN THE BOX ARE ADDRESSED TO**, as far as the page knows.
 * Text that is empty has no owner; everything else has exactly one of these.
 *
 * `not-kept` is the fail-safe. Words that were written for one conversation and
 * are now in front of another — the scope moved, or a different conversation
 * verified — stay on screen, because they are the person's, and are never
 * stored under either key. It lifts when the box is empty: an empty box holds
 * nobody's words, and what is typed next is addressed to whoever is there then.
 *
 * `unbound` is typing with no conversation seen yet in this scope. It is filed
 * under the first one that verifies — safe because a scope is one recipient.
 */
type Owner =
  | { kind: "empty" }
  | { kind: "unbound" }
  | { kind: "conversation"; id: string }
  | { kind: "purpose" }
  | { kind: "not-kept" };

type Op =
  | { kind: "put"; key: string; text: string }
  | { kind: "remove"; key: string }
  | { kind: "put-unplaced"; key: string; text: string; scope: string | null }
  | { kind: "remove-unplaced"; key: string };

type Held = {
  text: string;
  owner: Owner;
  /** The person has changed the box in this scope, so nothing may be restored into it. */
  touched: boolean;
  scope: string | null;
  /** The last conversation this scope verified. */
  lastSeen: string | null;
  /** The key already read for a restore in this scope, so it is read once rather than every render. */
  looked: string | null;
  /** The key holding a copy of this box's words — written from it or restored into it. What Clear removes. */
  filedUnder: string | null;
  /** The target scope in which page-only, unplaced words began. */
  unplacedUnder: string | null;
  /**
   * Storage writes decided and not yet made. Render and state updaters stay
   * pure; the effect below performs these after commit. Only ever appended to,
   * and trimmed by identity once performed.
   */
  pending: readonly Op[];
};

type Address = DraftAddress | { kind: "purpose" };

const EMPTY: Owner = { kind: "empty" };
const NOT_KEPT: Owner = { kind: "not-kept" };
const UNBOUND: Owner = { kind: "unbound" };
const PURPOSE: Owner = { kind: "purpose" };
const conversationOwner = (id: string): Owner => ({ kind: "conversation", id });

const START: Held = {
  text: "",
  owner: EMPTY,
  touched: false,
  scope: null,
  lastSeen: null,
  looked: null,
  filedUnder: null,
  unplacedUnder: null,
  pending: [],
};

/** `null` is the broadcast's key; anything else is a conversation id. */
type KeyOf = (conversationId: string | null) => string;

function startHeld(pageKey: string | null, scope: string | null): Held {
  if (pageKey === null) return START;
  const found = unplaced.get(pageKey);
  if (found === undefined || found.text === "") return START;
  return {
    ...START,
    text: found.text,
    touched: true,
    scope,
    owner: found.scope === scope ? UNBOUND : NOT_KEPT,
    unplacedUnder: found.scope,
  };
}

/** Restore into an untouched, empty box, reading each key once per scope. */
function restoreInto(h: Held, key: string, owner: Owner): Held {
  if (h.text !== "" || h.touched || h.looked === key) return h;
  const stored = readStored(key);
  if (stored === null || stored === "") return { ...h, looked: key };
  return { ...h, looked: key, text: stored, owner, filedUnder: key };
}

/**
 * **WHAT A NEW ADDRESS OR SCOPE DOES TO THE BOX, WITH NO KEYSTROKE.**
 *
 * Called on every render and returns `h` itself when nothing changes, so that
 * render-phase adjustment settles in one extra pass (continuity.ts explains the
 * pattern and why an effect would paint one wrong frame first). Reading storage
 * here is a read; every write is queued in `pending`.
 */
function settle(h: Held, address: Address, scope: string | null, keyOf: KeyOf, pageKey: string | null): Held {
  let n = h;
  if (scope !== null && scope !== n.scope) {
    if (n.scope === null) {
      n = { ...n, scope };
    } else if (n.text === "") {
      n = {
        ...n,
        scope,
        lastSeen: null,
        touched: false,
        looked: null,
        owner: EMPTY,
        filedUnder: null,
        unplacedUnder: null,
      };
    } else {
      /* Words from the last scope stay on screen. A conversation owner keeps
         its claim — a same-conversation relaunch is the same recipient, and the
         check below catches a different one — but blind typing from the last
         scope must not be filed under this scope's first conversation. */
      n = { ...n, scope, lastSeen: null, owner: n.owner.kind === "conversation" ? n.owner : NOT_KEPT };
    }
  }

  switch (address.kind) {
    case "verified": {
      const id = address.conversationId;
      const key = keyOf(id);
      if (n.lastSeen !== id) n = { ...n, lastSeen: id };
      if (n.owner.kind === "conversation" && n.owner.id !== id) n = { ...n, owner: NOT_KEPT };
      if (n.owner.kind === "unbound") {
        n = {
          ...n,
          owner: conversationOwner(id),
          filedUnder: key,
          unplacedUnder: null,
          pending: [
            ...n.pending,
            { kind: "put", key, text: n.text },
            ...(pageKey === null ? [] : [{ kind: "remove-unplaced" as const, key: pageKey }]),
          ],
        };
      }
      return restoreInto(n, key, conversationOwner(id));
    }
    case "cannot-tell":
      return n;
    case "hold":
      /* Restored as NOT-KEPT, not as that conversation's: the box is in front
         of something that is not its recipient, and no edit made here may be
         written back. `filedUnder` still names it, so Clear removes it. */
      if (n.text !== "" && n.owner.kind !== "not-kept") n = { ...n, owner: NOT_KEPT };
      return address.restoreFrom === null ? n : restoreInto(n, keyOf(address.restoreFrom), NOT_KEPT);
    case "purpose":
      return restoreInto(n, keyOf(null), PURPOSE);
    default: {
      const never: never = address;
      return never;
    }
  }
}

/** The person changed the box. Pure: storage is written by the effect. */
function edit(h: Held, address: Address, next: string, keyOf: KeyOf, pageKey: string | null): Held {
  if (next === "") {
    /* Deleting every character is removing the draft — except under `hold`,
       where nothing this box does is written back, a removal included. Clear
       is the explicit gesture and removes it there too. */
    const drop = address.kind !== "hold" && h.filedUnder !== null;
    return {
      ...h,
      text: "",
      owner: EMPTY,
      touched: true,
      filedUnder: drop ? null : h.filedUnder,
      unplacedUnder: null,
      pending: [
        ...h.pending,
        ...(drop && h.filedUnder !== null ? [{ kind: "remove" as const, key: h.filedUnder }] : []),
        ...(pageKey === null ? [] : [{ kind: "remove-unplaced" as const, key: pageKey }]),
      ],
    };
  }

  let owner: Owner;
  if (address.kind === "hold" || h.owner.kind === "not-kept") owner = NOT_KEPT;
  else if (address.kind === "purpose") owner = PURPOSE;
  else if (address.kind === "verified")
    owner =
      h.owner.kind === "conversation" && h.owner.id !== address.conversationId
        ? NOT_KEPT
        : conversationOwner(address.conversationId);
  else if (h.owner.kind === "conversation") owner = h.owner;
  else if (h.owner.kind === "empty" && h.lastSeen !== null) owner = conversationOwner(h.lastSeen);
  else owner = UNBOUND;

  const key = owner.kind === "conversation" ? keyOf(owner.id) : owner.kind === "purpose" ? keyOf(null) : null;
  const unplacedUnder = key === null && pageKey !== null ? (h.unplacedUnder ?? h.scope) : null;
  return {
    ...h,
    text: next,
    owner,
    touched: true,
    filedUnder: key ?? h.filedUnder,
    unplacedUnder,
    pending:
      key === null
        ? pageKey === null
          ? h.pending
          : [...h.pending, { kind: "put-unplaced", key: pageKey, text: next, scope: unplacedUnder }]
        : [
            ...h.pending,
            { kind: "put", key, text: next },
            ...(pageKey === null ? [] : [{ kind: "remove-unplaced" as const, key: pageKey }]),
          ],
  };
}

function cleared(h: Held, pageKey: string | null): Held {
  return {
    ...h,
    text: "",
    owner: EMPTY,
    touched: true,
    filedUnder: null,
    unplacedUnder: null,
    pending: [
      ...h.pending,
      ...(h.filedUnder === null ? [] : [{ kind: "remove" as const, key: h.filedUnder }]),
      ...(pageKey === null ? [] : [{ kind: "remove-unplaced" as const, key: pageKey }]),
    ],
  };
}

function versionKeyOf(h: Held, pageKey: string | null): string | null {
  if (h.text === "") return null;
  /* A session composer keeps one page identity while an unverifiable draft is
     later filed under a conversation, and across the keyed remount made by a
     process replacement. An in-flight submission must follow that transition. */
  if (pageKey !== null) return `page:${pageKey}`;
  return h.filedUnder === null ? null : storedVersionKey(h.filedUnder);
}

/** Moves the write generation of every key a change has just decided to write or remove. */
function advanceWritten(before: Held, after: Held): void {
  for (const op of after.pending.slice(before.pending.length)) {
    if (op.kind === "put" || op.kind === "remove") advanceVersion(storedVersionKey(op.key));
  }
}

/**
 * **TWO QUESTIONS, BOTH ASKED BEFORE EITHER COUNTER MOVES** — for the broadcast
 * they read the same counter.
 *
 * May the stored copy go? Only if nothing has written its key since the words
 * were submitted. That is per conversation, not per box, so a pane that has
 * moved on to conversation B and been typed into there still lets A's answer
 * take A's sent words out of storage, where they would otherwise wait to be
 * restored and sent again (F29, docs/plans/260910c). It never touches B's key.
 *
 * May the box be cleared? Only if the box has not changed since. That is per
 * box, so an edit made while the request was open survives on screen — and,
 * because that edit also wrote the key, in storage too.
 */
function acceptSubmission(submission: DraftSubmission): void {
  const { filed } = submission;
  const storedKey = filed !== null && versionOf(storedVersionKey(filed.key)) === filed.version ? filed.key : null;
  const boxCurrent = versionOf(submission.versionKey) === submission.version;
  if (storedKey !== null) {
    advanceVersion(storedVersionKey(storedKey));
    remove(storedKey);
  }
  if (!boxCurrent) return;
  advanceVersion(submission.versionKey);
  if (submission.pageKey !== null) unplaced.delete(submission.pageKey);
  for (const notify of acceptedSubmissions) notify(submission);
}

const PURPOSE_ADDRESS: Address = { kind: "purpose" };

/**
 * **THE ONE HOOK ALL THREE BOXES KEEP THEIR WORDS THROUGH.**
 *
 * It owns the box's text: the caller renders `text` and routes every change the
 * person makes through `setText`, calls `clear` from its Clear button, and
 * returns a `submission` to `accept` after a send the server accepted. That
 * generation-aware pair is why an old answer cannot erase later typing. It is
 * also why a
 * box with dictation — whose `onChange` is just another source of the person's
 * words — can hand it `setText` unchanged.
 */
export function useDraft(args: UseDraftArgs): Draft {
  const address: Address = args.purpose === "broadcast" ? PURPOSE_ADDRESS : args.address;
  const scope = args.purpose === "broadcast" ? null : (args.scope ?? null);
  const purpose = args.purpose;
  const pageKey = args.purpose === "broadcast" ? null : `${purpose}:${args.pageSlot}`;
  const keyOf: KeyOf = (id) =>
    purpose === "broadcast" || id === null ? draftKey("broadcast") : draftKey(purpose, id);

  const [held, setHeld] = useState<Held>(() => settle(startHeld(pageKey, scope), address, scope, keyOf, pageKey));

  /* Render-phase adjustment: the new address's consequences are in THIS
     render's output, not one frame later. `settle` returns its argument when
     there is nothing to do, so this converges. */
  const now = settle(held, address, scope, keyOf, pageKey);
  if (now !== held) setHeld(now);
  const latest = useRef(now);
  latest.current = now;

  /* Installed before an async completion can run after a replacement mount's
     commit. The ticket's own stored copy is removed above; this is the half
     that removes the copy already restored into the new textarea.

     It also removes a key the box's words were filed under *after* the send
     (F30): typing sent before any conversation verified has no key on its
     ticket, and the first verification then files it. The box is only told
     when its generation is unchanged since the ticket, so the words under that
     key are the words that were sent. The ticket's own key is left to the
     generation check above, never removed from here. */
  useLayoutEffect(() => {
    const onAccepted = (submission: DraftSubmission): void => {
      setHeld((h) => {
        if (versionKeyOf(h, pageKey) !== submission.versionKey) return h;
        const filedLater = h.filedUnder !== null && h.filedUnder !== submission.filed?.key ? h.filedUnder : null;
        return {
          ...h,
          text: "",
          owner: EMPTY,
          touched: true,
          filedUnder: null,
          unplacedUnder: null,
          pending: filedLater === null ? [] : [{ kind: "remove", key: filedLater }],
        };
      });
    };
    acceptedSubmissions.add(onAccepted);
    return () => {
      acceptedSubmissions.delete(onAccepted);
    };
  }, [pageKey]);

  const { pending } = now;
  useEffect(() => {
    if (pending.length === 0) return;
    for (const op of pending) {
      if (op.kind === "put") put(op.key, op.text);
      else if (op.kind === "remove") remove(op.key);
      else if (op.kind === "put-unplaced") unplaced.set(op.key, { text: op.text, scope: op.scope });
      else unplaced.delete(op.key);
    }
    /* By identity, not by count: an updater queued after this effect was
       scheduled may already have appended, and those must survive. The new
       object is also what re-renders the box after a refusal latched. */
    const done = new Set(pending);
    setHeld((h) => ({ ...h, pending: h.pending.filter((op) => !done.has(op)) }));
  }, [pending]);

  const notice: DraftNotice | null =
    now.text === "" ? null : refused ? "storage-refused" : now.text.length > DRAFT_CAP ? "too-long" : null;

  return {
    text: now.text,
    setText: (next) => {
      const before = latest.current;
      const after = edit(before, address, next, keyOf, pageKey);
      const changed = versionKeyOf(after, pageKey) ?? versionKeyOf(before, pageKey);
      if (changed !== null) advanceVersion(changed);
      advanceWritten(before, after);
      latest.current = after;
      setHeld(after);
    },
    clear: () => {
      const before = latest.current;
      const changed = versionKeyOf(before, pageKey);
      if (changed !== null) advanceVersion(changed);
      const after = cleared(before, pageKey);
      advanceWritten(before, after);
      latest.current = after;
      setHeld(after);
    },
    submission: () => {
      const current = latest.current;
      if (current.text === "" || current.owner.kind === "not-kept") return null;
      const versionKey = versionKeyOf(current, pageKey);
      if (versionKey === null) return null;
      return {
        text: current.text,
        versionKey,
        version: versionOf(versionKey),
        filed:
          current.filedUnder === null
            ? null
            : { key: current.filedUnder, version: versionOf(storedVersionKey(current.filedUnder)) },
        pageKey,
      };
    },
    accept: acceptSubmission,
    canSubmit: now.owner.kind !== "not-kept",
    notice,
  };
}
