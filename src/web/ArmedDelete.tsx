/**
 * **Chat's two-press delete**, in its own module since 2026-10-27 so Skim's
 * brief picker can use the same control rather than a copy (plan
 * docs/plans/261027d-several-skim-briefs-per-article-and-a-picker-between-them.md
 * § Stage 4; controls.md § Controls that do the same job look the same).
 * Drawn with `.chat-icon` (styles/mode-band.css), which is global.
 */
import { type RefObject, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";

/** How long an armed delete stays armed. */
const DISARM_MS = 4000;

/**
 * Delete, but only if you say so twice.
 *
 * One press arms it — the icon turns red and its tooltip changes to say what
 * the next press will do — and a second press within a few seconds deletes.
 * Not a `window.confirm`, which blocks the tab and cannot be styled, and not an
 * Undo strip like the shelf's, because a deleted conversation is really gone
 * rather than archived and there would be nothing to put back.
 *
 * **Deliberately stricter than the same button on the list.** There, the row is
 * one of several and its title is right beside the mouse; here, the thing you
 * are about to destroy is the page you are reading, and a single stray click
 * takes an hour of argument with it.
 *
 * The timeout disarms it, so a button left red on a panel nobody has touched
 * for a minute cannot be pressed by accident later. Mounted with `key={id}`, so
 * changing conversation gives it a fresh unarmed one.
 */
export function ArmedDelete({
  onDelete,
  tip = "Delete this conversation",
  armedTip = "Press again to delete this conversation",
  size = 14,
  buttonRef,
}: {
  onDelete(): void;
  /** What the button says at rest, and once armed. Learn calls it Start over. */
  tip?: string;
  armedTip?: string;
  /** The bin's size: 14 in a header, 12 beside a question's pencil. */
  size?: number;
  /** Lets a row hand focus somewhere stable before this button disappears. */
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), DISARM_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`chat-icon danger${armed ? " armed" : ""}`}
      data-tip={armed ? armedTip : tip}
      data-tip-describes="off"
      aria-label={armed ? armedTip : tip}
      onClick={() => (armed ? onDelete() : setArmed(true))}
    >
      <Trash2 size={size} aria-hidden="true" />
    </button>
  );
}
