/**
 * One turn of a conversation, and the nine ways of naming who said it.
 *
 * ## WHY THIS IS ITS OWN FILE
 *
 * It was `Turn` and `SPEAKERS` inside `RecentMessages.tsx`, which draws one
 * session's tail in the detail pane. The "Recent messages" tab needs the same
 * thing across every session, and the session that owns `RecentMessages.tsx`
 * asked for the extraction rather than a second copy — **on a correctness
 * argument rather than a tidiness one**, which is worth keeping:
 *
 * > `Turn` is small but it renders `SPEAKERS`, a nine-arm map over
 * > `MessageSpeaker`, and two of those arms are traps: `compact-summary` and
 * > `injected`. […] a second renderer that collapses those into `human`, or
 * > that quietly falls through on an arm it does not know, shows a fabricated
 * > recap as something a person said. That is exactly the class of bug your tab
 * > would be worst placed to notice, because you are showing turns from
 * > sessions the reader was not watching and has no independent sense of.
 * >
 * > — session `dashboard-titles-descriptions-detail`, 2026-09-09
 *
 * Duplicating the markup is cheap. Duplicating a nine-arm discrimination and
 * its two landmines is not.
 *
 * ## UNTRUSTED, ALL OF IT
 *
 * Every string here is agent-authored text from a process that may have been
 * handling hostile input. React escapes it and nothing here adds markup: no
 * raw-HTML escape hatch, no markdown renderer, no linkifier. A test in
 * tests/fleet-web.test.tsx globs this directory for the raw-HTML prop name, so
 * the rule is enforced rather than remembered.
 *
 * And one thing that is untrusted in a subtler way: **an unfamiliar speaker is
 * drawn as unfamiliar.** transcript.ts calls a `compact-summary` *"the single
 * most convincing wrong answer this module could give"* — machine-written text
 * wearing `role: "user"`. Rounding a speaker this build cannot name to "the
 * agent" would misattribute a message, so it is labelled as unknown instead.
 */
import type { ReactNode } from "react";

import { Explain, type Tip } from "./Tooltip";
import { instantTip } from "./instant";
import type { MessageSpeaker, MessageTurn } from "./messages-client";
import { Mono, cx } from "./ui";

/**
 * How each speaker is named, and which of them need a warning beside the name.
 *
 * `note` is non-null only for the ones a reader would otherwise get wrong.
 * `human` has one because a steer sent from THIS PAGE lands here too and is
 * indistinguishable from Greg at the keyboard by anything in the transcript —
 * transcript.ts refuses to guess and so does this.
 */
export const SPEAKERS: Record<MessageSpeaker, { label: string; note: string | null; tone: string }> = {
  human: {
    label: "typed at the pane",
    note: "a person, or a steering message sent from this page — the transcript cannot tell them apart",
    tone: "tw:text-needs-ink",
  },
  assistant: { label: "the agent", note: null, tone: "tw:text-work-ink" },
  peer: { label: "another agent", note: "over the peer socket, not a person", tone: "tw:text-work-ink" },
  notification: { label: "machinery", note: "a subagent finishing, or an auto-continuation", tone: "tw:text-ink-faint" },
  "compact-summary": {
    label: "a compaction summary",
    note: "written by Claude Code when the conversation ran out of context, and it wears a person's role — nobody said this",
    tone: "tw:text-unknown-ink",
  },
  injected: {
    label: "an injected reminder",
    note: "machinery wearing a person's role — nobody typed this",
    tone: "tw:text-unknown-ink",
  },
  "api-error": { label: "an API error", note: null, tone: "tw:text-alarm-ink" },
  system: { label: "Claude Code itself", note: null, tone: "tw:text-ink-faint" },
  unrecognised: {
    label: "an unknown speaker",
    note: "this build does not know this kind of turn, so it will not say who said it",
    tone: "tw:text-unknown-ink",
  },
};

/**
 * **A card per speaker, because the label is a claim and the reader cannot
 * check it.**
 *
 * The nine labels above are the distinctions `transcript.ts` verified on disk,
 * and several of them are unguessable from the words alone: *machinery* and *an
 * injected reminder* sound like the same thing, *another agent* and *the agent*
 * differ by one word and by everything, and the two that matter most —
 * `compact-summary` and `injected` — are machine-written text wearing a
 * person's role, which is the one mistake this whole vocabulary exists to
 * prevent.
 *
 * **This is a card and not more `note` text** because `note` is already used
 * for the warning that has to be visible without asking, and six of the nine
 * carry one. What goes here is the provenance: where the distinction was
 * measured, and what rounding it to a neighbour would misattribute. Every `how`
 * below is quoted down from `tools/fleet/transcript.ts` § `TurnSpeaker`, not
 * written for this file — a tooltip that explains a reading has to say what it
 * was measured from.
 *
 * **Used twice**: on the badge over each message, where the reader meets the
 * word, and on the filter chips in `FeedPanel`. The badge does nothing when
 * tapped, so its card opens under a finger; the chips toggle a filter, so
 * theirs is `mouseOnly` and the label has to stand on its own — which is why
 * the definitions are also here, on a surface a phone can reach.
 */
export const SPEAKER_TIPS: Record<MessageSpeaker, Tip> = {
  human: {
    head: "Typed at the pane",
    what: "Somebody typed this into the session's own terminal. A steer sent from this dashboard lands here too, and deliberately.",
    how: "Across two real transcripts, 64 of 389 records wearing a person's role were classified here and the other 325 were machinery of one kind or another. It says where the words entered the session, never who composed them: a steer and Greg at the keyboard look the same to a transcript.",
  },
  assistant: {
    head: "The agent",
    what: "The model's own prose: this session's agent, writing to whoever is watching.",
    how: "A turn here with no words at all is a real state and not a failed read — it called tools and said nothing. Anything the API refused is drawn as its own speaker instead, so a broken run is never mistaken for a quiet one.",
  },
  peer: {
    head: "Another agent",
    what: "A message a different agent sent over the peer socket, delivered into this session as an ordinary turn. Not a person.",
    how: "It arrives flagged both as harness-injected and as a peer, and reading the first flag first labelled every one of these an injected reminder — which reads as boilerplate to skip past rather than as a colleague asking for something.",
  },
  notification: {
    head: "Machinery",
    what: "A subagent finishing, or an auto-continuation. The harness telling the session that something happened.",
    how: "The largest category by far of what looks like a person speaking: 321 of the 389 user-role records counted on disk were these — 319 subagent notifications and two auto-continuations, which this one label covers both of. That count is the measurement the nine-way split came out of.",
  },
  "compact-summary": {
    head: "A compaction summary",
    what: "Claude Code's recap of the conversation so far, written when the context ran out and the older turns were dropped.",
    how: "It wears a person's role and opens “This session is being continued from a previous conversation…” — transcript.ts calls it the single most convincing wrong answer it could give, because it reads exactly like somebody restating the task.",
  },
  injected: {
    head: "An injected reminder",
    what: "A reminder or caveat the harness put into the conversation. Nobody typed it, and nobody chose to send it.",
    how: "Machinery wearing a person's role, like a compaction summary. Rounding either of them to “typed at the pane” would put the harness's words in Greg's mouth, which is the specific misattribution this vocabulary exists to stop.",
  },
  "api-error": {
    head: "An API error",
    what: "A failure from the model API, written into the transcript where the agent's reply would have been.",
    how: "It reaches the reader as an assistant record and is pulled out into its own speaker here, so a session that fell over is never read as one that answered.",
  },
  system: {
    head: "Claude Code itself",
    what: "The harness's own notes — records that carry text but come from neither the model nor anybody at the keyboard.",
    how: "It is a separate speaker because it is demonstrably neither the model nor anybody at the keyboard — not because anything here knows more about it than that. The source says only that these are Claude Code's own records that carry text.",
  },
  unrecognised: {
    head: "An unknown speaker",
    what: "A turn whose kind is not one of the eight this build knows. It is shown, with its words, and left unattributed.",
    how: "Deliberately not rounded to the nearest familiar speaker. Two of the eight kinds it is not are machine-written text wearing a person's role, so a wrong guess here would misattribute a message rather than merely describe it vaguely.",
  },
};

/** One turn. Text and tool calls, and neither is markup. */
export function Turn({ turn }: { turn: MessageTurn }): ReactNode {
  const who = SPEAKERS[turn.speaker];
  return (
    <li className="transcript-turn tw:border-t tw:border-rule tw:py-2 tw:first:border-t-0">
      <p className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:text-[11px]">
        {/* No `mouseOnly`: this badge does nothing when tapped, so the finger
            that wants to know what "an injected reminder" is may have it. */}
        <Explain tip={SPEAKER_TIPS[turn.speaker]} placement="bottom">
          <span className={cx("tw:font-semibold tw:tracking-wide tw:uppercase", who.tone)}>{who.label}</span>
        </Explain>
        {turn.at === null ? null : (
          <Explain tip={instantTip(turn.at)} placement="bottom">
            <span className="tw:text-ink-faint">{turn.at}</span>
          </Explain>
        )}
      </p>
      {who.note === null ? null : <p className="tw:mt-0.5 tw:text-[11px] tw:text-ink-faint">{who.note}</p>}
      {turn.text === "" ? (
        /* An assistant turn with no words and some tool calls is a REAL state,
           not a missing one — transcript.ts says so. Drawing nothing here would
           make it look like a turn that failed to load. */
        <p className="tw:mt-1 tw:text-[13px] tw:text-ink-faint tw:italic">
          {turn.toolCalls.length > 0 ? "No words in this turn — it only called tools." : "No words and no tool calls in this turn."}
        </p>
      ) : (
        /* Untrusted text. `whitespace-pre-wrap` keeps the agent's own line
           breaks without anything interpreting them. */
        <p className="tw:mt-1 tw:text-[13px] tw:break-words tw:whitespace-pre-wrap tw:text-ink">{turn.text}</p>
      )}
      {turn.truncated ? (
        <p className="tw:mt-0.5 tw:text-[11px] tw:text-ink-faint">
          Cut short{turn.fullChars === null ? "" : ` — ${turn.fullChars.toLocaleString()} characters in full`}.
        </p>
      ) : null}
      {turn.toolCalls.length === 0 ? null : (
        <ul className="tw:mt-1 tw:space-y-0.5">
          {turn.toolCalls.map((call, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a turn's tool calls have no id of their own, and this list is fixed for the life of the turn — never reordered, appended to or filtered — so the index IS a stable identity here. Two calls to the same tool with the same detail are otherwise indistinguishable.
            <li key={`${call.name}-${i}`} className="tw:text-[12px] tw:text-ink-soft">
              <Mono>{call.name}</Mono>
              {call.detail === null ? null : <span className="tw:pl-2 tw:break-all tw:text-ink-faint">{call.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
