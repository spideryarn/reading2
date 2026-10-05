/**
 * The reader's global profile, fetched and saved — "about you".
 *
 * One value, one owner: `/profile` edits it, everything else reads it. The
 * per-article half ("why you're reading this one") is not here — it rides on
 * the shelf record and is edited on the metadata page, because it is about an
 * article and this is not. src/profile.ts joins the two server-side, which is
 * the only place they meet. docs/project/reader-profile.md.
 *
 * ## Saving on blur, and after a pause
 *
 * This said "on blur, not on a timer" until 2026-10-01: a timer means a save
 * that can be in flight when the tab closes, and a textarea "saved" three
 * times mid-sentence. Greg asked for the timer (spya-czbj9r: *"Maybe auto-save
 * any time it has been idle for a few seconds?"*), so `ProfileBox` now commits
 * after two idle seconds as well as on blur, and asks before a reader leaves
 * with a save pending. The save itself — one at a time, written back only over
 * what was sent, flushed when the tab is hidden and fired with `keepalive` as
 * the page goes — moved into [`useAutosavedText`](./useAutosavedText.ts), which
 * Metadata's purpose box shares. What is left here is where the string comes
 * from and where it goes. docs/plans/261001l-autosave-about-you-and-honest-mic-fallback.md.
 *
 * **A save that fails silently is the whole hazard here.** The box goes on
 * showing what the reader typed, so the page looks exactly as it does when it
 * worked — and the profile they believe every glossary is being written to is
 * a string the server never received. docs/reusable/silent-success.md. That is
 * why the state the box draws is the hook's, not a sentence the page writes.
 */
import { useEffect } from "react";
import { apiFetch, leavingFetch, readJson } from "./lib/api.js";
import { profileSaved } from "./profile-saved.js";
import { type AutosavedText, useAutosavedText } from "./useAutosavedText.js";

const HEADERS = { "Content-Type": "application/json" };
const bodyFor = (text: string) => JSON.stringify({ profile: text === "" ? null : text });

/**
 * Store "about you", and answer with what the server stored. Exported for the
 * profile panel (ProfilePanel.tsx), which edits the same string in place —
 * shared rather than copied, because a copy is a second place to forget
 * `forgetSummaries`.
 */
export async function saveProfile(text: string): Promise<string> {
  const body = await readJson<{ profile: string | null }>(
    await apiFetch("/api/reader", { method: "PATCH", headers: HEADERS, body: bodyFor(text) }),
  );
  /* **The link cards' summaries were written from this.** They are cached per
     tab in front of a server that compares a profile hash and would have
     noticed (src/web/link-facts.ts § `forgetSummaries`) — so without this, a
     reader who rewrites their description and goes back to an article gets the
     answers written for the old one, on a card where nothing looks wrong. GPT
     Sol, 2026-09-05. `profileSaved` forgets them, and tells the command bar
     its list from why you are reading is old (src/web/profile-saved.ts). */
  profileSaved();
  return body.profile ?? "";
}

/* **Not through `apiFetch`, and that is the whole point.** `apiFetch` awaits
   `getSession()` before it starts the request, and a page being torn down can
   be killed inside that await — no error, no request in the network tab, just a
   lost sentence. `leavingFetch` uses the token the SDK already holds and starts
   at once; a token that expired in the last few seconds is refused, which is
   strictly better than not sending. GPT Sol, 2026-08-26.

   **And it forgets the link summaries, twice** (2026-10-04). This fires on
   unmount as well as `pagehide`, so the page is usually still here afterwards
   — and a `pagehide` can be a bfcache suspend that brings it back, cache and
   all. Once as the write leaves, so the old answers stop being shown; and again
   when it settles, which is the one that counts: a summary asked for in between
   was written from the profile the server still had, and the second call
   throws that away too. `saveProfile` needs only the one because it calls
   after the response. tests/link-summary-forget.test.tsx. */
export function leaveProfile(text: string): void {
  profileSaved();
  void leavingFetch("/api/reader", { method: "PATCH", headers: HEADERS, body: bodyFor(text) }).then(
    profileSaved,
  );
}

export type UseProfile = AutosavedText;

export function useProfile(): UseProfile {
  const text = useAutosavedText({ save: saveProfile, leave: leaveProfile });
  const { seed, fail } = text;

  useEffect(() => {
    let live = true;
    apiFetch("/api/reader")
      .then((r) => readJson<{ profile: string | null }>(r))
      .then((body) => live && seed(body.profile ?? ""))
      .catch((e: Error) => live && fail(e.message));
    return () => {
      live = false;
    };
  }, [seed, fail]);

  return text;
}

/*
 * `useHasProfile(slug)` lived here until 2026-09-13: it asked
 * `/api/reader?slug=` whether this reader had a profile, so a panel knew
 * whether to draw the *Use your profile* checkbox. The checkbox and its row went
 * on Greg's request, and nothing asked the question any more.
 * docs/plans/260913a-drop-the-use-your-profile-checkbox.md.
 */
