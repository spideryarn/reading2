/**
 * **The live words, in the thread, where they will stay.**
 *
 * Until 261002j they streamed into a box under the composer and then appeared
 * a second time as saved rows above it — Greg: *"it was sort of showing the
 * words streaming in, but in one place, but then they'd show up in the chat in
 * another place … could those not be the same place"* (spya-f4eq7p). So they
 * are drawn here, after the saved turns, in the same bubbles a saved exchange
 * gets, with a quiet mark while they are still arriving.
 *
 * **Exactly one copy is ever on screen.** An exchange leaves this list in the
 * same commit the chat controller's provisional rows for it arrive — the hook
 * does the handoff (`flushLines` in useLiveConversation.ts) — and comes back
 * the same way if the write fails. Grouped and ordered by exchange, not by
 * arrival: ./tail.ts says why.
 *
 * Passage pointers are not drawn here yet: the latest one stays in the status
 * strip. Attaching each to its own provisional reply needs the pointers owned
 * by exchange, which they are not (plan § After the plan review).
 */
import type { LiveApi } from "./useLiveConversation.js";
import { liveGroups } from "./tail.js";

export function LiveTail({ live }: { live: LiveApi }) {
  /* "Still arriving" only while a session can still deliver to these lines.
     Once it has ended, a line that never got its final transcript — an answer
     cut off by a hang-up or a failure — is as finished as it will ever be, and
     a cursor blinking at it for ever would be a claim that more is coming. */
  const arriving = live.phase === "live" || live.phase === "connecting" || live.phase === "closing";
  const lines = arriving ? live.lines : live.lines.filter((line) => line.text.trim() !== "");
  if (lines.length === 0) return null;
  const cursor = (done: boolean) => !done && arriving ? <span className="chat-cursor" aria-hidden="true" /> : null;
  return (
    <section className="chat-live-tail" aria-label="Spoken, not yet saved">
      {live.hasUnsavedLines && <p className="chat-live-notice chat-live-unsaved">
        Couldn’t confirm whether these words were saved, or where they belong in the conversation. They’re kept
        here for you.
      </p>}
      {liveGroups(lines).map((group) => (
        <div key={group.key} className="chat-live-exchange">
          {group.reader.map((line) => (
            <div key={line.id} className={`chat-turn you chat-live-line ${line.role}`}>
              <span className="chat-live-words">{line.text || "…"}</span>{cursor(line.done)}
            </div>
          ))}
          {group.companion.map((line) => (
            <div key={line.id} className={`chat-turn model chat-live-line ${line.role}`}>
              <p><span className="chat-live-words">{line.text}</span>{cursor(line.done)}</p>
            </div>
          ))}
          {arriving && [...group.reader, ...group.companion].some((line) => !line.done) &&
            <p className="chat-live-arriving">still arriving</p>}
        </div>
      ))}
    </section>
  );
}
