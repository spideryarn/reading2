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
import { readJson } from "./lib/api.js";

export interface UseProfile {
  /** What the server holds. `null` while loading, and `""` for "never written". */
  profile: string | null;
  /** What is in the box right now — the draft, which may differ from `profile`. */
  draft: string;
  setDraft(next: string): void;
  /** Save the draft if it differs from what the server holds. Safe to call twice. */
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
    fetch("/api/reader")
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

  const flush = useCallback(() => {
    const { profile: saved, draft: current } = latest.current;
    // Nothing typed, or nothing changed. Not an early return for tidiness: a
    // PATCH per blur would rewrite the row every time the reader tabbed past.
    if (saved === null || current === saved) return;
    setSaving(true);
    setError(null);
    fetch("/api/reader", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: current === "" ? null : current }),
    })
      .then((r) => readJson<{ profile: string | null }>(r))
      .then((body) => {
        /* The server's answer, not the draft — it normalises (trims, settles
           line endings), and the box must show the string that was actually
           stored. Otherwise a reader who pasted trailing whitespace sees one
           thing and every prompt carries another. Same rule `useShelf` follows
           after a rename. */
        const value = body.profile ?? "";
        setProfile(value);
        setDraft(value);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false));
  }, []);

  /* The tab closing, or the reader navigating away, with the caret still in the
     box. `pagehide` rather than `beforeunload`: it fires on the mobile
     back-forward cache path too, which `beforeunload` does not, and this app is
     read on an iPad. The request may not complete — that is the honest limit of
     doing this at all — but not trying is strictly worse. */
  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [flush]);

  return { profile, draft, setDraft, flush, error, saving };
}
