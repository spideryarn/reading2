/**
 * **One saved string, edited in a box that saves itself.** The draft, what the
 * server holds, and the save between them.
 *
 * Greg, 2026-09-30 (spya-czbj9r), about the "About you" box: *"make it clearer
 * when it has saved … if I try and close the page before it has saved, either
 * warn the user, or auto-save … Perhaps this could be a reusable
 * text-input-box auto-save component that we could reuse in other places (e.g.
 * Article/Metadata/Why are you reading)"*. Two halves, and this is the data
 * one: [`ProfileBox`](./ProfileBox.tsx) draws the box, runs the idle timer and
 * asks before the page unloads; this owns the save. `/profile` reaches it
 * through `useProfile`, Metadata's "Why you're reading this one" directly.
 * docs/plans/261001l-autosave-about-you-and-honest-mic-fallback.md.
 *
 * ## The things in here that are not obvious
 *
 * **One save at a time, and the newest text queued behind it.** A box that
 * saves after every pause makes overlapping saves the ordinary case, and two
 * PATCHes in flight can be *applied* by the server in either order: the older
 * one landing second would overwrite the newer, after the box had already
 * said "Saved" about it. Ignoring a late *response*, which is what `useProfile`
 * did before, cannot stop that. So a commit while one is in flight only marks
 * that another is wanted, and it goes when the first comes back, carrying
 * whatever is in the box by then. GPT Sol's plan review, 2026-10-01, item 1.
 *
 * **The answer is written back only over the text that was sent.** The server
 * normalises (trims, settles line endings) and the box should show what was
 * stored — but the reader is usually typing again by the time it lands, and
 * writing over that takes back words the server never saw. Left alone they
 * differ from `saved`, and the box says "Unsaved changes", which is true.
 *
 * **`setDraft` updates a ref before it updates state.** Dictation calls
 * `onChange` with the transcript and then `onCommit` in the same tick; a commit
 * reading React state would read the text from before the words landed, and on
 * Safari, which has no live words, save nothing at all. GPT Sol, item 3.
 *
 * **Saving on the way out.** `visibilitychange → hidden` makes an ordinary
 * save, while there is still time — on iOS it is often the only event a closing
 * tab sends. `pagehide` is the last chance and fires the caller's `leave`,
 * which should be a `keepalive` request (`leavingFetch`): it ignores the queue,
 * because the ordinary save in flight is exactly the one the browser may kill.
 * That one can, in principle, be applied after it; the PATCH is idempotent and
 * the window is the page being torn down, which is the honest limit of doing
 * this at all.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Where a box's text stands against what the server holds — what
 * `ProfileBox` draws under it.
 *
 * `clean` is "matches what was loaded, and nothing has been saved this visit";
 * `saved` is the same match *after* a save, which is the only time a tick is
 * news rather than decoration.
 */
export type SaveState =
  | { kind: "loading" }
  | { kind: "clean" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

/** The facts, folded into one state in one order. */
function saveStateOf(f: {
  loaded: boolean;
  error: string | null;
  saving: boolean;
  dirty: boolean;
  savedThisVisit: boolean;
}): SaveState {
  if (f.error) return { kind: "error", message: f.error };
  if (!f.loaded) return { kind: "loading" };
  if (f.saving) return { kind: "saving" };
  if (f.dirty) return { kind: "dirty" };
  return f.savedThisVisit ? { kind: "saved" } : { kind: "clean" };
}

export interface AutosavedText {
  /** What the server holds. `null` until seeded. */
  saved: string | null;
  draft: string;
  setDraft(next: string): void;
  /** Start from this stored value, dropping anything about an earlier one. */
  seed(value: string): void;
  /** Save the draft if it differs from what is stored. Safe to call often. */
  commit(): void;
  /** For a load that failed: said in the status line, the box stays shut. */
  fail(message: string): void;
  /**
   * Whether a write is still on the wire, including one for an older draft.
   *
   * This cannot be recovered from `state`: that deliberately says `dirty`
   * rather than `saving` when the box has moved on, and it can say `clean`
   * when the reader has moved back to the value loaded before that older
   * write. A caller that promises not to close until every write has settled
   * needs the request fact as well as the words shown under the box.
   */
  inFlight: boolean;
  state: SaveState;
}

export function useAutosavedText({
  save,
  leave,
}: {
  /** Store the text; resolve with what was actually stored. */
  save(text: string): Promise<string>;
  /** Best effort while the page is going away. Must not await anything first. */
  leave(text: string): void;
}): AutosavedText {
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraftState] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedThisVisit, setSavedThisVisit] = useState(false);

  const now = useRef({ saved: null as string | null, draft: "" });
  const inFlight = useRef(false);
  const queued = useRef(false);
  /* Bumped by `seed`, so a save begun for the previous value — Metadata's box
     moving to another article — cannot land on the new one. */
  const epoch = useRef(0);
  const io = useRef({ save, leave });
  io.current = { save, leave };

  const setDraft = useCallback((next: string) => {
    now.current.draft = next;
    setDraftState(next);
    /* A refusal describes the text that was sent. Once the reader edits that
       text — including back to the stored value — it must not keep the box in
       an error state that can neither save nor become clean. */
    setError(null);
  }, []);

  const seed = useCallback((value: string) => {
    epoch.current++;
    inFlight.current = false;
    queued.current = false;
    now.current = { saved: value, draft: value };
    setSaved(value);
    setDraftState(value);
    setSending(null);
    setError(null);
    setSavedThisVisit(false);
  }, []);

  const fail = useCallback((message: string) => setError(message), []);

  const commit = useCallback(() => {
    const { saved: stored, draft: text } = now.current;
    // Nothing loaded cannot be saved. Test the request before "nothing
    // changed", though: the draft may have returned to `stored` while an
    // older write is still on its way to replace it. That needs a correction
    // queued behind the write, not an early return that lets the older value
    // win after the box already said clean.
    if (stored === null) return;
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    // A PATCH per blur would rewrite the row every time the reader tabbed past.
    if (text === stored) return;
    inFlight.current = true;
    const mine = epoch.current;
    setSending(text);
    setError(null);
    /* A `save` that throws before returning a promise must still reach
       `finally` — otherwise `inFlight` stays set and every later commit queues
       behind a save that will never come back. Started synchronously all the
       same: on the way out of a page, a microtask can be one too many. */
    let request: Promise<string>;
    try {
      request = io.current.save(text);
    } catch (e) {
      request = Promise.reject(e);
    }
    request
      .then((value) => {
        if (mine !== epoch.current) return;
        now.current.saved = value;
        setSaved(value);
        if (now.current.draft === text) {
          now.current.draft = value;
          setDraftState(value);
        }
        setSavedThisVisit(true);
      })
      .catch((e: Error) => {
        if (mine === epoch.current) setError(e.message);
      })
      .finally(() => {
        if (mine !== epoch.current) return;
        inFlight.current = false;
        setSending(null);
        if (queued.current) {
          queued.current = false;
          commit();
        }
      });
  }, []);

  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") commit();
    };
    const gone = () => {
      const { saved: stored, draft: text } = now.current;
      if (stored !== null && text !== stored) io.current.leave(text);
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", gone);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", gone);
    };
  }, [commit]);

  const state = saveStateOf({
    loaded: saved !== null,
    error,
    /* "Saving" only about the text in the box. Typing on while a save is out
       makes the box dirty again, and saying "Saving…" about words that are
       not in that request is the silent success this whole file is against. */
    saving: sending !== null && sending === draft,
    dirty: saved !== null && draft !== saved,
    savedThisVisit,
  });

  return { saved, draft, setDraft, seed, commit, fail, inFlight: sending !== null, state };
}
