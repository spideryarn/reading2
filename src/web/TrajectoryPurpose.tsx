/**
 * **What the route was planned for, and the question when nobody has said** —
 * the one line Trajectory's band carries about the article's purpose, owner
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
import { savePurpose, usePurpose } from "./purpose.js";
import { carriedSearch, readHref } from "./router.js";
import { Tooltip } from "./Tooltip.js";
import type { UseTrajectory } from "./useTrajectory.js";

interface Props {
  owner: UseTrajectory;
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
      <div className="traj-purpose">
        <Tooltip content={<p>{purpose}</p>} placement="bottom" className="traj-purpose-tip">
          {/* Focusable so a keyboard reaches the whole sentence too. */}
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the tooltip's trigger */}
          <span className="traj-purpose-said" tabIndex={0}>
            <span className="traj-purpose-label">Reading for:</span>{" "}
            <span className="traj-purpose-text">{purpose}</span>
          </span>
        </Tooltip>
        <Link
          className="traj-purpose-edit"
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
      if (!live.current) return;
      planning.current = false;
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSaving(false);
      return;
    }
    if (!live.current) return;
    setSaved(stored);
    setSaving(false);
    await owner.ensure();
  };

  return (
    <div className="traj-purpose traj-purpose-ask">
      <label className="traj-purpose-q" htmlFor="traj-purpose-input">
        What do you want from this piece?
      </label>
      <textarea
        id="traj-purpose-input"
        className="traj-purpose-input"
        rows={2}
        maxLength={MAX_PURPOSE_CHARS}
        placeholder="e.g. how they handled missing data"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="traj-purpose-foot">
        <Button type="button" variant="outline" size="sm" disabled={busy || text === ""} onClick={() => void plan()}>
          <Route size={13} />
          Plan the route for this
        </Button>
        <span className="traj-purpose-note">A paid model call.</span>
      </div>
      {error !== null && (
        <p className="gloss-error" role="alert">
          Not saved — {error}
        </p>
      )}
    </div>
  );
}
