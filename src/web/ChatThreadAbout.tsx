/**
 * **Which model answered this conversation, and how hard it was asked to
 * think** — a paragraph in an open conversation's (i), after Chat's own words.
 *
 * Greg, spya-pd9fnc, 2026-10-08: *"in the information icon for the chat
 * thread, I was hoping it would show me which model it had been using, and
 * perhaps even thinking level."*
 *
 * Read from each finished answer's stored `model` and `effort` (src/types.ts
 * § `ChatMessage`), never worked out from today's settings: High-powered AI
 * can be switched mid-conversation, and the table that decides the thinking
 * changes, so each answer says what it was given. Answers are grouped by
 * model and thinking, in the order they first appear. A failed answer stores
 * neither and is not counted; nor is one still arriving. An answer from
 * before 2026-10-08 has a model and no thinking level, and says so rather
 * than guessing. Plan 261008b § 2.
 */
import type { AnswerEffort, ChatMessage } from "../types.js";
import { displayName } from "../model-names.js";

export interface AnsweredBy {
  /** The model's name as a person reads it (`displayName`). */
  model: string;
  effort: AnswerEffort | undefined;
  answers: number;
}

export function answeredBy(messages: readonly ChatMessage[]): AnsweredBy[] {
  const groups: AnsweredBy[] = [];
  for (const m of messages) {
    if (m.role !== "assistant" || m.status !== "done" || !m.model) continue;
    const model = displayName(m.model);
    const same = groups.find((g) => g.model === model && g.effort === m.effort);
    if (same) same.answers += 1;
    else groups.push({ model, effort: m.effort, answers: 1 });
  }
  return groups;
}

/** The thinking, in words. */
export function thinkingWords(effort: AnswerEffort | undefined): string {
  if (effort === undefined) return "thinking level not recorded";
  if (effort === "default") return "thinking as much as the model chooses";
  if (effort === "none") return "with thinking switched off";
  return `thinking effort ${effort}`;
}

/** In the card's provenance voice, `AboutMade`'s (`.band-about-made`), and its list (`.band-about-list`). */
export function ChatThreadAbout({ messages }: { messages: readonly ChatMessage[] }) {
  const groups = answeredBy(messages);
  if (groups.length === 0) return null;
  if (groups.length === 1) {
    const [only] = groups as [AnsweredBy];
    return (
      <p className="band-about-made">
        This conversation was answered by {only.model}, {thinkingWords(only.effort)}.
      </p>
    );
  }
  return (
    <>
      <p className="band-about-made">This conversation was answered by:</p>
      <ul className="band-about-list band-about-made">
        {groups.map((g) => (
          <li key={`${g.model} ${g.effort ?? ""}`}>
            {g.model}, {thinkingWords(g.effort)} — {g.answers} {g.answers === 1 ? "answer" : "answers"}
          </li>
        ))}
      </ul>
    </>
  );
}
