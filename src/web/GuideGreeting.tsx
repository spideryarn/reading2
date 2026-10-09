/**
 * **The guide's greeting: our words, and no model call** — and, under the
 * reader's first answer to it, *Keep this as why you're reading*.
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
import { useRef, useState } from "react";
import { Link } from "./Link.js";
import { useMadeFor } from "./lib/made-for.js";
import { type Greeting, type GreetingRun, keepableReason } from "./guide-greeting.js";
import { savePurpose, storedPurpose } from "./purpose.js";
import { PROFILE_HREF, readHref } from "./router.js";

/**
 * **What *Ask the guide where to start* sends**, as the reader's first message
 * — so what they pressed is what the transcript shows, and what the guide
 * answers with their reason in front of it (`GUIDE_SYSTEM`, src/converse.ts).
 */
export const GUIDE_FIRST_QUESTION = "I've said why I'm reading this. Where should I start?";

/** The button's words. */
export const GUIDE_START_LABEL = "Ask the guide where to start";

/** The keep button's words, and what it says once the reason is kept. */
export const KEEP_REASON_LABEL = "Keep this as why you're reading";
export const KEPT_REASON_LABEL = "Kept as why you're reading this one.";

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
              If you tell us a little about yourself on your <Link href={PROFILE_HREF}>profile</Link>, I can fit
              my suggestions to you.
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

type KeepState =
  | { kind: "offer" }
  | { kind: "saving" }
  | { kind: "kept" }
  /** A reason was already stored by the time of the press: nothing is overwritten. */
  | { kind: "already" }
  | { kind: "failed" };

/**
 * ***Keep this as why you're reading*, under the reader's first message** in a
 * guide whose greeting asked for the reason. The reader's own words and the
 * reader's own press: no model chooses or writes them, which is why this needs
 * no proposal id and no exception in docs/project/security-map.md.
 *
 * - Offered only when the message fits as it would be stored
 *   (`keepableReason`); a longer one gets a link to Metadata instead.
 * - **Never overwrites.** The press asks the server what is stored first, and
 *   a reason saved since the greeting's read (another tab, Metadata) is kept
 *   and said so. Two tabs of one reader pressing within the same fraction of a
 *   second could still both write; the loser's words are their own, and
 *   Metadata shows which won.
 * - One write per press: a second press while one is in flight does nothing.
 * - A save that rejects is checked against the server before it is called a
 *   failure, since the reply can be lost after the write (`savePurpose`).
 */
export function GuideKeepReason({ slug, text }: { slug: string; text: string }) {
  const madeFor = useMadeFor();
  const [state, setState] = useState<KeepState>({ kind: "offer" });
  const busy = useRef(false);
  const reason = keepableReason(text);
  const metadata = readHref(slug, "", "metadata");

  if (reason === null) {
    return (
      <p className="chat-empty-hint guide-keep">
        Too long to keep as why you're reading this one; you can write a shorter one on{" "}
        <Link href={metadata}>Metadata</Link>.
      </p>
    );
  }

  const keep = async () => {
    if (busy.current) return;
    busy.current = true;
    setState({ kind: "saving" });
    try {
      const before = await storedPurpose(slug);
      if (before === null) {
        setState({ kind: "failed" });
        return;
      }
      if (before.purpose !== null) {
        setState(before.purpose === reason ? { kind: "kept" } : { kind: "already" });
        return;
      }
      try {
        await savePurpose(slug, reason, madeFor);
        setState({ kind: "kept" });
      } catch {
        const after = await storedPurpose(slug);
        setState(after?.purpose === reason ? { kind: "kept" } : { kind: "failed" });
      }
    } finally {
      busy.current = false;
    }
  };

  switch (state.kind) {
    case "kept":
      return (
        <p className="chat-empty-hint guide-keep" role="status">
          {KEPT_REASON_LABEL} You can change it on <Link href={metadata}>Metadata</Link>.
        </p>
      );
    case "already":
      return (
        <p className="chat-empty-hint guide-keep" role="status">
          You had already saved a reason for this one, so I left it as it was. It is on{" "}
          <Link href={metadata}>Metadata</Link>.
        </p>
      );
    default:
      return (
        <div className="guide-keep">
          <button
            type="button"
            className="chat-suggest-btn"
            disabled={state.kind === "saving"}
            onClick={() => void keep()}
          >
            {KEEP_REASON_LABEL}
          </button>
          {state.kind === "failed" && (
            <span className="chat-empty-hint" role="alert">
              {" "}
              Couldn't save it. Try again, or write it on <Link href={metadata}>Metadata</Link>.
            </span>
          )}
        </div>
      );
  }
}
