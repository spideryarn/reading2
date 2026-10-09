/**
 * **What the guide says first, before any model is asked** — plan
 * docs/plans/261009i-the-guide-greets-in-chat-takes-live-and-a-bar-row.md.
 *
 * > I think if we're in a chat interface, I want to use the chat interface. …
 * > check, you know, have I entered a user profile? Have I entered why you're
 * > reading this? And then depending on that, maybe it would deterministically
 * > generate an initial message
 * >
 * > — Greg, 2026-10-09, `spya-s6qhzv`
 *
 * So the greeting is ours, chosen by what `GET /api/reader?slug=` says, and it
 * asks its question in the conversation: the reader answers in the composer,
 * not in a box. Nothing is spent until they send. Pure, so each arm of the
 * plan's table is a test.
 *
 * It is made of runs, not one string, because three voices are in it
 * (docs/project/fonts.md): our words, the article's title, and the reader's
 * own words quoted back — and each is set in its own face.
 */
import { clamp } from "../title-text.js";
import type { PurposeRead } from "./purpose.js";

/** One run of the greeting, in the voice it is drawn in. */
export type GreetingRun =
  | { readonly voice: "ours"; readonly text: string }
  | { readonly voice: "title"; readonly text: string }
  | { readonly voice: "reader"; readonly text: string };

export interface Greeting {
  /** Paragraphs, each a list of runs. */
  readonly paragraphs: readonly (readonly GreetingRun[])[];
  /** A reason is stored, so *Ask the guide where to start* is a complete request. */
  readonly offersStart: boolean;
  /** About you is definitively empty, so the line pointing at the profile page is drawn. */
  readonly invitesProfile: boolean;
}

/** How much of *About you* is quoted back: enough to recognise, not the whole of it (Opus on the plan). */
export const PROFILE_QUOTE_CHARS = 120;
/** How much of a stored reason is quoted back. */
export const PURPOSE_QUOTE_CHARS = 160;

const ours = (text: string): GreetingRun => ({ voice: "ours", text });
const quoted = (text: string, max: number): GreetingRun => ({
  voice: "reader",
  text: `“${clamp(text.replace(/\s+/g, " ").trim(), max)}”`,
});

/**
 * The greeting for what we know, or `null` while the read is still going —
 * one stable greeting once it has answered, rather than one that changes under
 * the reader (GPT Sol's F5 on the plan).
 *
 * A read that failed, or a shelf the server could not read, is never taken for
 * "you have not said": the greeting then asks nothing and claims nothing.
 */
export function guideGreeting(read: PurposeRead, title: string | undefined): Greeting | null {
  if (read.state === "loading") return null;
  const name = title?.trim();
  const hello: GreetingRun[] = name
    ? [ours("Hi, I'm your guide to "), { voice: "title", text: clamp(name, 120) }, ours(".")]
    : [ours("Hi, I'm your guide to this piece.")];

  if (read.state === "failed" || read.purposeFailed) {
    return {
      paragraphs: [
        [...hello, ours(" Ask me where to start, what to search for, or which of Spideryarn's modes would help you read it.")],
      ],
      offersStart: false,
      invitesProfile: false,
    };
  }

  const profile = read.profile;
  if (read.purpose !== null) {
    return {
      paragraphs: [
        [...hello, ours(" You said you're reading it because "), quoted(read.purpose, PURPOSE_QUOTE_CHARS), ours(".")],
        [ours("I can suggest where to start, what to read closely, and which modes would help.")],
      ],
      offersStart: true,
      invitesProfile: profile === null,
    };
  }

  const tell = ours("Tell me below, and I'll suggest where to start and which modes would help.");
  if (profile === null) {
    return {
      paragraphs: [
        [...hello, ours(" Why are you reading it?")],
        [tell],
        [ours("If you like, tell me a little about yourself too: what you do, and how much you already know about this subject.")],
      ],
      offersStart: false,
      invitesProfile: false,
    };
  }
  return {
    paragraphs: [
      hello,
      [ours("In About you, you wrote "), quoted(profile, PROFILE_QUOTE_CHARS), ours(". Is that still right?")],
      [ours("More importantly, why are you reading this one? "), tell],
    ],
    offersStart: false,
    invitesProfile: false,
  };
}
