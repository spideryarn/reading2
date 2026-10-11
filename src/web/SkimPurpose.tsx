/**
 * **What the route was planned for, and the question when nobody has said** —
 * the one line Skim's band carries about the article's purpose, owner
 * only. docs/plans/260930e-ask-why-you-are-reading-and-a-trajectory-for-that-intent.md
 * § Stage 2; the purpose itself is docs/project/reader-profile.md.
 *
 * - **Set**: *Reading for: …* on one line, the whole sentence in a tooltip,
 *   and **Edit**, which opens the box below in place, filled with the
 *   sentence (since 2026-10-11; a link to Metadata's box before). Greg,
 *   spya-wu83xh: *"an optional input box so that you could say what it is
 *   that you're trying to skim for. In that way, it wouldn't be so different
 *   from the search box."* The purpose is what the route is planned for
 *   already, so this is that box, asked as *What are you skimming for?*, not a
 *   second, Skim-only focus with its own storage (plan 261011r says why).
 * - **Not set, and a route on screen**, or **editing**: the box and *Plan the
 *   route for this*, which saves the purpose and, **only once the save has
 *   answered**, asks for the route with `ensure()`. Unforced is enough: a
 *   route's stamp carries the profile hash, so the server re-plans one
 *   written for another profile. The box never saves an empty sentence —
 *   clearing the purpose stays in Metadata — nor the sentence already saved.
 *
 * **Never in the empty state** (Sol F6). With no route, `useAutoRun` plans one
 * as the mode opens, and a second request made with a different profile would
 * not de-duplicate against it — two paid routes. The caller mounts this only
 * when a route is ready. And never when the purpose could not be read: a reader
 * told "you have not said" types over the sentence they already wrote.
 */
import { useEffect, useRef, useState } from "react";
import { Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_PURPOSE_CHARS } from "../types.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { savePurpose, storedPurpose, usePurpose } from "./purpose.js";
import { profileSaved } from "./profile-saved.js";
import { Tooltip } from "./Tooltip.js";
import type { UseSkim } from "./useSkim.js";

interface Props {
  owner: UseSkim;
  /** A stale or profile-changed banner is up: it already offers the re-plan, so do not ask again. */
  bannerUp: boolean;
}

export function PurposeLine({ owner, bannerUp }: Props) {
  const read = usePurpose(owner.slug);
  /** What the server stored after a press here — it wins over the read. */
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  /** The box is open over a saved purpose — *Edit* was pressed. */
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* State disables the visible control; the ref closes the smaller gap before
     React re-renders, when two clicks could otherwise send two PATCHes and call
     `ensure()` twice. */
  const planning = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      planning.current = false;
    };
  }, []);

  if (read.state !== "ready" || read.purposeFailed) return null;
  const purpose = saved ?? read.purpose;

  const set = purpose !== null && purpose !== "";
  /* A route being planned, or a forced one whose result is not read yet:
     another request now would race it (GPT Sol, plan review F6). */
  const planningElsewhere = owner.starting || owner.job !== null || owner.rewriting;
  if (set && (!editing || bannerUp)) {
    return (
      <div className="skim-purpose">
        <Tooltip content={<p>{purpose}</p>} placement="bottom" className="skim-purpose-tip">
          {/* Focusable so a keyboard reaches the whole sentence too. */}
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the tooltip's trigger */}
          <span className="skim-purpose-said" tabIndex={0}>
            <span className="skim-purpose-label">Reading for:</span>{" "}
            <span className="skim-purpose-text">{purpose}</span>
          </span>
        </Tooltip>
        {/* Not under a banner: its own button re-plans, and two ways to ask
            for a route at once is the race the hold exists to stop. */}
        {!bannerUp && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="skim-purpose-edit"
            disabled={planningElsewhere}
            onClick={() => {
              setDraft(purpose);
              setError(null);
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )}
      </div>
    );
  }

  /* The box waits under a banner, whose own button re-plans. */
  if (bannerUp) return null;

  const busy = saving || planningElsewhere;
  const text = draft.trim();
  /* Saving the sentence already saved would re-plan nothing and say it had. */
  const unchanged = set && text === purpose;
  const plan = async () => {
    /* Never an empty draft: `savePurpose(slug, null)` erases (plan F1). */
    if (text === "" || unchanged || busy || planning.current) return;
    planning.current = true;
    setSaving(true);
    setError(null);
    let stored: string | null;
    try {
      stored = await savePurpose(owner.slug, text);
    } catch (err) {
      /* **A save that rejected may still have been stored** (purpose.ts §
         `savePurpose`), so ask what is there before saying which it was. This
         said "Not saved" for every rejection until 2026-10-07. */
      const why = describeFetchFailure(err as Error);
      const held = await storedPurpose(owner.slug);
      if (!live.current) return;
      /* `text` is what the server would hold: it trims and settles `\r\n`, and
         a textarea's value never carries a `\r`. */
      if (held === null || held.purpose !== text) {
        planning.current = false;
        setError(
          held === null
            ? /* No code: the reason's own sentence can claim more than is known
                 here ("nothing was sent"), and Metadata's delete says the same
                 thing the same way (copy.md § The words on the one control). */
              "Couldn't tell whether that was saved, so no route was planned. Your words are still " +
                "in the box. Reload the page to see what is stored."
            : /* What the read showed, not what the write did: another tab can
                 replace a save that landed before this read (GPT Sol, K4-F3). */
              `These words are not what is saved for this article, so no route was planned. ${why}`,
        );
        setSaving(false);
        return;
      }
      /* It is there. Invalidate work made from the old purpose, just as
         savePurpose does after a readable reply, then carry on as asked. */
      profileSaved();
      stored = held.purpose;
    }
    if (!live.current) return;
    setSaved(stored);
    setSaving(false);
    setEditing(false);
    /* Held until the route has been asked for, so a press in between cannot
       send a second save and a second `ensure()`. */
    await owner.ensure();
    planning.current = false;
  };

  return (
    <div className="skim-purpose skim-purpose-ask">
      <label className="skim-purpose-q" htmlFor="skim-purpose-input">
        What are you skimming for?
      </label>
      <textarea
        id="skim-purpose-input"
        className="skim-purpose-input"
        rows={2}
        maxLength={MAX_PURPOSE_CHARS}
        placeholder="e.g. how they handled missing data"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="skim-purpose-foot">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || text === "" || unchanged}
          onClick={() => void plan()}
        >
          <Route size={13} />
          Plan the route for this
        </Button>
        {editing && (
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
        <span className="skim-purpose-note">
          A paid model call. Saved as your purpose for this piece, which other modes use too.
        </span>
      </div>
      {error !== null && (
        <p className="gloss-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
