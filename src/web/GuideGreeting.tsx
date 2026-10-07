/**
 * **The guide's empty state: our words, and no model call.** Plan
 * docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md, § The
 * design, 3: *"The greeting is ours, not a model's … Nothing is spent until the
 * reader sends."*
 *
 * Shaped like the other conversations' empty states (ChatPanel.tsx §
 * `TutorialInvitation`, `ExploreInvitation`): a few plain sentences, and a
 * button only where pressing it is a complete request. What it shows depends on
 * what the reader has already told us, read from `GET /api/reader?slug=`
 * (`usePurpose`):
 *
 * - **No reason for reading stored** → the very box the first-open prompt and
 *   Metadata hold for *Why you're reading this one* — `ProfileBox` with
 *   `useAutosavedText` and `savePurpose`, wired as PurposePrompt.tsx wires it,
 *   so it saves itself — and a line saying they can answer there or type below.
 *   **The reader's own words are what is saved; nothing a model wrote ever
 *   becomes their reason** (GPT Sol's F5 on the plan, which is why there is no
 *   `purpose` button).
 * - **About you empty** → one light line pointing at their profile page.
 * - **A reason stored, or just saved in the box** → *Ask the guide where to
 *   start*, which sends `GUIDE_FIRST_QUESTION`. The press is the consent to
 *   spend; nothing is asked before it.
 *
 * A read that failed, or a shelf the server could not read (`purposeFailed`),
 * is never taken for "you have not said": no box over a sentence the reader
 * may already have written, and no button promising a reason we cannot see.
 *
 * The words are the app's, so they are set in the app's face; the reader's
 * own reason is in their box, which `ProfileBox` draws (docs/project/fonts.md).
 */
import { useEffect, useRef } from "react";
import { MAX_PURPOSE_CHARS } from "../types.js";
import { Link } from "./Link.js";
import { ProfileBox } from "./ProfileBox.js";
import { useMadeFor } from "./lib/made-for.js";
import { leavePurpose, savePurpose, usePurpose } from "./purpose.js";
import { PROFILE_HREF } from "./router.js";
import { useAutosavedText } from "./useAutosavedText.js";

/**
 * **What *Ask the guide where to start* sends**, as the reader's first message
 * — so what they pressed is what the transcript shows, and what the guide
 * answers with their reason in front of it (`GUIDE_SYSTEM`, src/converse.ts).
 */
export const GUIDE_FIRST_QUESTION = "I've said why I'm reading this. Where should I start?";

/** The button's words. */
export const GUIDE_START_LABEL = "Ask the guide where to start";

export function GuideGreeting({ slug, onAsk }: { slug: string; onAsk(question: string): void }) {
  const read = usePurpose(slug);
  /* The reader the box was mounted for, so its unmount save cannot go out as
     the next one (lib/made-for.ts), exactly as PurposePrompt.tsx's. */
  const madeFor = useMadeFor();
  const purpose = useAutosavedText({
    /* The server's answer, not what was typed, and an empty box clears: the
       box is seeded only over a reason that is definitively none, so there
       is nothing hidden to erase. */
    save: async (text) => (await savePurpose(slug, text === "" ? null : text, madeFor)) ?? "",
    leave: (text) => leavePurpose(slug, text, madeFor),
  });
  const seed = purpose.seed;

  const known = read.state === "ready" && !read.purposeFailed;
  /* Asked once, at the read: a box that appeared after the reader saved into
     it would vanish under them, so once shown it stays. */
  const asking = known && read.purpose === null;
  const seeded = useRef(false);
  useEffect(() => {
    if (!asking || seeded.current) return;
    seeded.current = true;
    seed("");
  }, [asking, seed]);

  const hasReason = known && (read.purpose !== null || (purpose.saved ?? "").trim() !== "");
  const noProfile = read.state === "ready" && read.profile === null;

  return (
    <div className="chat-suggest guide-greeting">
      <p className="chat-empty-hint">
        I'm here to help you read this piece well, and to get the most out of Spideryarn while you do. {asking
          ? "Tell me why you're reading it, and I'll suggest where to start, what to search for, and which modes would help."
          : hasReason
            ? "I can suggest where to start, what to search for, and which modes would help."
            : "Ask me where to start, what to search for, or which modes would help."}
      </p>
      {asking && (
        <>
          <ProfileBox
            id="guide-purpose"
            label="Why you're reading this one"
            placeholder="e.g. I want to know how they handled missing data"
            hint="Saved as you type, for this article only. You can change it later on Metadata."
            value={purpose.draft}
            onChange={purpose.setDraft}
            onCommit={purpose.commit}
            max={MAX_PURPOSE_CHARS}
            disabled={purpose.saved === null}
            rows={2}
            save={purpose.state}
            inFlight={purpose.inFlight}
          />
          <p className="chat-empty-hint">You can answer in the box above, or just type below.</p>
        </>
      )}
      {noProfile && (
        <p className="chat-empty-hint">
          If you tell us a little about yourself on your <Link href={PROFILE_HREF}>profile</Link>, I can
          fit my suggestions to you.
        </p>
      )}
      {hasReason && (
        <ul>
          <li>
            <button type="button" className="chat-suggest-btn" onClick={() => onAsk(GUIDE_FIRST_QUESTION)}>
              {GUIDE_START_LABEL}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
