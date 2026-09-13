/**
 * The reader's global profile, fetched and saved — "about you".
 *
 * One value, one owner: `/profile` edits it, everything else reads it. The
 * per-article half ("why you're reading this one") is not here — it rides on
 * the shelf record and is edited on the metadata page, because it is about an
 * article and this is not. src/profile.ts joins the two server-side, which is
 * the only place they meet. docs/project/reader-profile.md.
 *
 * ## Saving on blur, not on a timer
 *
 * There is no debounce anywhere in this client, and this does not introduce
 * one. `TitleEditor` in Library.tsx commits on blur or Enter, and that is the
 * established shape: a timer means a save that can be in flight when the tab
 * closes, and a textarea that has been "saved" three times mid-sentence. Blur
 * is a real moment the reader chose.
 *
 * The cost of blur-to-save is that a reader who closes the tab with the caret
 * still in the box loses what they typed — so `flush` exists and the page wires
 * it to `pagehide`. That is one of the two things the plan's review named:
 * *"flush debounced saves on blur/navigation and surface failed saves;
 * otherwise the textarea can display text that was never stored."* The other is
 * below.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, leavingFetch, readJson } from "./lib/api.js";
import { forgetSummaries } from "./link-facts.js";

export interface UseProfile {
  /** What the server holds. `null` while loading, and `""` for "never written". */
  profile: string | null;
  /** What is in the box right now — the draft, which may differ from `profile`. */
  draft: string;
  setDraft(next: string): void;
  /**
   * Save the draft if it differs from what the server holds.
   *
   * Safe to call twice — and that is enforced rather than hoped for: a body
   * already in flight is not sent again, and a response that arrives after a
   * newer save is dropped instead of writing its stale text back into the box.
   */
  flush(): void;
  /**
   * Whether the last save failed, and with what.
   *
   * **A save that fails silently is the whole hazard here.** The box goes on
   * showing what the reader typed, so the page looks exactly as it does when it
   * worked — and the profile they believe every glossary is being written to is
   * a string the server never received. docs/reusable/silent-success.md.
   */
  error: string | null;
  saving: boolean;
}

export function useProfile(): UseProfile {
  const [profile, setProfile] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /* Read by `flush`, which is wired to `pagehide` and so runs outside React's
     render cycle — reading state through a closure there would flush whatever
     the values were when the listener was attached. */
  const latest = useRef({ profile: null as string | null, draft: "" });
  latest.current = { profile, draft };

  useEffect(() => {
    let live = true;
    apiFetch("/api/reader")
      .then((r) => readJson<{ profile: string | null }>(r))
      .then((body) => {
        if (!live) return;
        const value = body.profile ?? "";
        setProfile(value);
        setDraft(value);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);

  /* Which save is the newest. Bumped before each request and checked when the
     response lands, so an earlier one that comes back late is dropped rather
     than allowed to write its stale text over a newer edit — the classic
     out-of-order-response bug, and here it would silently revert something the
     reader had just typed. GPT Sol's review of the built code, 2026-08-26. */
  const generation = useRef(0);
  /* What is already in flight, so blur followed immediately by `pagehide` — or
     two blurs — do not send the same body twice. */
  const inFlight = useRef<string | null>(null);

  const flush = useCallback((leaving = false) => {
    const { profile: saved, draft: current } = latest.current;
    // Nothing typed, or nothing changed. Not an early return for tidiness: a
    // PATCH per blur would rewrite the row every time the reader tabbed past.
    if (saved === null || current === saved) return;
    /* **`leaving` ignores what is in flight, and that is deliberate.**
     *
       The de-duplication below stops a blur and a `visibilitychange` sending the
       same body twice, which is right. But it also meant that a
       `visibilitychange` starting an ordinary fetch would make the `pagehide`
       that followed it decline to send — and the ordinary fetch is exactly the
       one the browser is entitled to kill as the document goes away. The reader
       would lose the sentence, with both mechanisms having "worked".
     *
       The PATCH is idempotent, so a duplicate costs one wasted request and the
       row ends up the same either way. GPT Sol, 2026-08-27. */
    if (!leaving && inFlight.current === current) return;
    inFlight.current = current;
    const mine = ++generation.current;
    const body = JSON.stringify({ profile: current === "" ? null : current });
    const headers = { "Content-Type": "application/json" };

    /* **The leaving case does not go through `apiFetch`, and that is the whole
       of this branch.**
     *
       `keepalive` lets a request outlive the document — that was already here,
       and it is why `pagehide` was worth doing at all. But `apiFetch` now
       `await`s `getSession()` *before* it starts the request, and a page being
       torn down can be killed inside that await. A best-effort save would have
       become a save that often never leaves, and it would have looked like
       nothing: no error, no request in the network tab, just a lost sentence.

       So `leavingFetch` uses the token the SDK already has in memory and starts
       immediately. The trade is explicit: a token that expired in the last few
       seconds is refused and the save is lost. That is strictly better than not
       sending. GPT Sol, 2026-08-26 — and see the `visibilitychange` listener
       below, which is the real fix, because the best way to survive `pagehide`
       is to have already saved. */
    if (leaving) {
      leavingFetch("/api/reader", { method: "PATCH", headers, body });
      inFlight.current = null;
      return;
    }

    setSaving(true);
    setError(null);
    apiFetch("/api/reader", { method: "PATCH", headers, body })
      .then((r) => readJson<{ profile: string | null }>(r))
      .then((body) => {
        if (mine !== generation.current) return;
        /* The server's answer, not the draft — it normalises (trims, settles
           line endings), and the box must show the string that was actually
           stored. Otherwise a reader who pasted trailing whitespace sees one
           thing and every prompt carries another. Same rule `useShelf` follows
           after a rename. */
        const value = body.profile ?? "";
        setProfile(value);
        setDraft(value);
        /* **The link cards' summaries were written from this.** They are cached
           per tab in front of a server that compares a profile hash and would
           have noticed (src/web/link-facts.ts § `forgetSummaries`) — so without
           this, a reader who rewrites their description and goes back to an
           article gets the answers written for the old one, on a card where
           nothing looks wrong. GPT Sol, 2026-09-05. */
        forgetSummaries();
      })
      .catch((e: Error) => {
        if (mine === generation.current) setError(e.message);
      })
      .finally(() => {
        if (inFlight.current === current) inFlight.current = null;
        if (mine === generation.current) setSaving(false);
      });
  }, []);

  /* The tab closing, or the reader navigating away, with the caret still in the
     box. `pagehide` rather than `beforeunload`: it fires on the mobile
     back-forward cache path too, which `beforeunload` does not, and this app is
     read on an iPad. The request may not complete — that is the honest limit of
     doing this at all — but not trying is strictly worse. */
  useEffect(() => {
    const leave = () => flush(true);
    window.addEventListener("pagehide", leave);

    /* **Save before the page is going away, not while it is.** `pagehide` is
       the last chance and a poor one — the ordinary flush above is a full
       request with error handling, and this one is a shot in the dark. A tab
       being switched away from, or an app being backgrounded on an iPad, fires
       `visibilitychange` first and while there is still time to do it properly.
       On iOS this is often the *only* one that fires. */
    const hidden = () => {
      if (document.visibilityState === "hidden") flush(false);
    };
    document.addEventListener("visibilitychange", hidden);

    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [flush]);

  return { profile, draft, setDraft, flush, error, saving };
}

/*
 * `useHasProfile(slug)` lived here until 2026-09-13: it asked
 * `/api/reader?slug=` whether this reader had a profile, so a panel knew
 * whether to draw the *Use your profile* checkbox. The checkbox and its row went
 * on Greg's request, and nothing asked the question any more.
 * docs/plans/260913a-drop-the-use-your-profile-checkbox.md.
 */
