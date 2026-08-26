/**
 * Who you are signed in as, and how to stop being.
 *
 * **On `/profile` rather than in a corner of every page.** This page is already
 * the one about *you* rather than about an article
 * (docs/project/reader-profile.md), and the alternative — a permanent account
 * chip in the top-left — competes for the one rectangle HomeLogo.tsx spends
 * fifty lines establishing is free. Two clicks from the reading view is also
 * about right for something nobody should do by accident.
 *
 * ## Signing out is more than clearing a token
 *
 * `signOut()` drops the session, and every request after it is refused. But a
 * chat stream the server has **already admitted** keeps arriving — the token is
 * an admission check, not a per-frame one (lib/api.ts) — and React state still
 * holds the last reader's article, profile and threads.
 *
 * So this reloads the page rather than re-rendering it. A hard navigation is
 * the one thing guaranteed to abort every in-flight `fetch` and drop every
 * piece of state, and "the next person at this keyboard sees nothing of the
 * last one" is worth more than the frame it costs. Raised in review, 2026-08-26.
 */
import { useState } from "react";
import { LogOut } from "lucide-react";

import { supabase } from "./lib/supabase.js";
import { useSession } from "./useSession.js";

export function AccountSection() {
  const { user } = useSession();
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  /* Which provider vouched for this, so "why can't I sign in with my password?"
     has an answer on the page rather than in somebody's memory. */
  const provider = user.app_metadata?.provider ?? "email";

  const out = async () => {
    setBusy(true);
    await supabase.auth.signOut();
    /* See the header: a reload, not a re-render. `replace` so Back does not
       return to a page rendered for somebody who is no longer here. */
    location.replace("/");
  };

  return (
    <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
      <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
        Signed in as <span className="tw:text-foreground">{user.email}</span>
        <span className="tw:text-ink-faint"> · via {provider}</span>
      </p>
      <button
        type="button"
        onClick={() => void out()}
        disabled={busy}
        className="tw:inline-flex tw:items-center tw:gap-1.5 tw:rounded-md tw:border tw:border-border tw:px-3 tw:py-1.5 tw:text-xs tw:text-muted-foreground tw:hover:text-foreground tw:disabled:opacity-60"
      >
        <LogOut size={13} />
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
