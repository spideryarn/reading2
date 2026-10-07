/**
 * **What the route was planned for, and the question when nobody has said** —
 * the one line Skim's band carries about the article's purpose, owner
 * only. docs/plans/260930e-ask-why-you-are-reading-and-a-trajectory-for-that-intent.md
 * § Stage 2; the purpose itself is docs/project/reader-profile.md.
 *
 * - **Set**: *Reading for: …* on one line, the whole sentence in a tooltip,
 *   and **Edit**, a link to the Metadata page's box — where it is edited.
 * - **Not set, and a route on screen**: a box and *Plan the route for this*,
 *   which saves the purpose and, **only once the save has answered**, asks for
 *   the route with `ensure()`. Unforced is enough: a route's stamp carries the
 *   profile hash, so the server re-plans one written for another profile.
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
import { Link } from "./Link.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { savePurpose, storedPurpose, usePurpose } from "./purpose.js";
import { carriedSearch, readHref } from "./router.js";
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

  if (purpose !== null && purpose !== "") {
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
        <Link
          className="skim-purpose-edit"
          href={readHref(owner.slug, carriedSearch(location.search), "metadata")}
        >
          Edit
        </Link>
      </div>
    );
  }

  if (bannerUp) return null;

  const busy = saving || owner.starting || owner.job !== null;
  const text = draft.trim();
  const plan = async () => {
    /* Never an empty draft: `savePurpose(slug, null)` erases (plan F1). */
    if (text === "" || busy || planning.current) return;
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
            : `That was not saved, so no route was planned. ${why}`,
        );
        setSaving(false);
        return;
      }
      /* It is there. Carry on as the press asked. */
      stored = held.purpose;
    }
    if (!live.current) return;
    setSaved(stored);
    setSaving(false);
    await owner.ensure();
  };

  return (
    <div className="skim-purpose skim-purpose-ask">
      <label className="skim-purpose-q" htmlFor="skim-purpose-input">
        What do you want from this piece?
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
        <Button type="button" variant="outline" size="sm" disabled={busy || text === ""} onClick={() => void plan()}>
          <Route size={13} />
          Plan the route for this
        </Button>
        <span className="skim-purpose-note">A paid model call.</span>
      </div>
      {error !== null && (
        <p className="gloss-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
