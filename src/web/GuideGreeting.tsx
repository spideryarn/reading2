/**
 * **The guide's greeting: our words, and no model call.**
 *
 * What the reader says in answer is saved only when the guide offers it and
 * they press (GuideSaveOffer.tsx, plan
 * docs/plans/261009o-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md).
 * Before that plan, a button under their first message, *Keep this as why
 * you're reading*, saved that message verbatim; the offer replaced it.
 *
 * Plan docs/plans/261009i-the-guide-greets-in-chat-takes-live-and-a-bar-row.md,
 * after Greg's report (2026-10-09, `spya-s6qhzv`): *"It shows the input box
 * for why you're reading this, and so I put in some text in there, and then I
 * was like, well, now what? … if we're in a chat interface, I want to use the
 * chat interface."* Until then (plan 261007j) the greeting held an autosaving
 * box. Now it asks its question in the conversation, the reader answers in the
 * composer, and the words are what `guideGreeting` (./guide-greeting.ts)
 * chooses from `GET /api/reader?slug=`.
 *
 * Drawn as the conversation's opening while it is empty, and kept above the
 * turns for as long as this conversation stays mounted, so the reader's first
 * message is visibly an answer to it. A guide opened with turns already in it
 * shows no greeting: one rebuilt from today's profile above last week's
 * answers would be a message nobody sent (GPT Sol's F5 on the plan).
 *
 * The words are the app's, set in the app's face; the title is the author's
 * and the quoted lines are the reader's, each in its own (docs/project/fonts.md).
 */
import { Compass } from "lucide-react";
import { Link } from "./Link.js";
import type { Greeting, GreetingRun } from "./guide-greeting.js";
import { PROFILE_HREF } from "./router.js";

/**
 * **What *Ask the guide where to start* sends**, as the reader's first message
 * — so what they pressed is what the transcript shows, and what the guide
 * answers with their reason in front of it (`GUIDE_SYSTEM`, src/converse.ts).
 */
export const GUIDE_FIRST_QUESTION = "I've said why I'm reading this. Where should I start?";

/** The button's words. */
export const GUIDE_START_LABEL = "Ask the guide where to start";

function Run({ run }: { run: GreetingRun }) {
  if (run.voice === "title") return <span className="guide-greeting-title">{run.text}</span>;
  if (run.voice === "reader") return <span className="guide-greeting-reader">{run.text}</span>;
  return <>{run.text}</>;
}

export function GuideGreeting({ greeting, onAsk }: { greeting: Greeting; onAsk(question: string): void }) {
  return (
    <div className="chat-suggest guide-greeting" role="note" aria-label="The guide's greeting">
      <div className="guide-greeting-bubble">
        <Compass size={14} aria-hidden="true" className="guide-greeting-icon" />
        <div>
          {greeting.paragraphs.map((paragraph, i) => (
            <p key={i} className="chat-empty-hint">
              {paragraph.map((run, j) => (
                <Run key={j} run={run} />
              ))}
            </p>
          ))}
          {greeting.invitesProfile && (
            <p className="chat-empty-hint">
              If you tell me a little about yourself, here or on your <Link href={PROFILE_HREF}>profile</Link>, I
              can fit my suggestions to you.
            </p>
          )}
        </div>
      </div>
      {greeting.offersStart && (
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
