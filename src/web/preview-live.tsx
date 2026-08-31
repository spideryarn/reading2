/**
 * A throwaway page for trying live conversation mode in a real browser.
 * docs/plans/live-conversation.md; the hook is ./live/useLiveConversation.ts.
 *
 * Nothing in the app links here and it is not in the router. It talks to
 * `scripts/live-spike.ts` on 127.0.0.1:5399, which has to be running.
 *
 * **The two buttons are the point of the page.** "Talk" is the real thing and
 * needs a person, because a microphone permission is browser chrome and no
 * automated session can grant one. "Connect silently" opens exactly the same
 * session with a synthetic silent track and no permission at all — so an agent
 * can check the token, the SDP exchange, the data channel, the tool loop, the
 * pointing and the model's own transcript, and only the microphone itself is
 * left for a human. Everything the two share is the shipping path.
 *
 * The panel at the bottom lists every event type the session sent, handled or
 * not. That is the instrument, not decoration — see the hook's header for the
 * two spellings of the assistant-transcript event and why guessing between them
 * would have produced a silent blank.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";

import { useLiveConversation } from "./live/useLiveConversation.js";

const SLUG =
  new URLSearchParams(location.search).get("slug") ?? "noema-mythology-of-conscious-ai";

function Page() {
  const live = useLiveConversation(SLUG);
  const [typed, setTyped] = useState("");
  const busy = live.phase === "connecting" || live.phase === "live";

  return (
    <main>
      <h1>Live conversation — spike</h1>
      <p className="sub">
        <code>{SLUG}</code> · <code>{live.phase}</code>
        {live.hearing && <span className="pill hear">hearing you</span>}
        {live.speaking && <span className="pill speak">speaking</span>}
      </p>

      <div className="row">
        <button type="button" onClick={() => live.start({ microphone: true })} disabled={busy}>
          Talk (needs the mic)
        </button>
        <button type="button" onClick={() => live.start({ microphone: false })} disabled={busy}>
          Connect silently
        </button>
        <button type="button" onClick={live.stop} disabled={live.phase !== "live"}>
          Hang up
        </button>
      </div>

      {live.error && <p className="err">{live.error}</p>}

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          live.say(typed);
          setTyped("");
        }}
      >
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Type a turn, as if you'd said it…"
          disabled={live.phase !== "live"}
        />
        <button type="submit" disabled={live.phase !== "live"}>
          Say it
        </button>
      </form>

      <section>
        <h2>Transcript</h2>
        {live.lines.length === 0 && <p className="quiet">Nothing said yet.</p>}
        {live.lines.map((l) => (
          <p key={l.id} className={`line ${l.role}`}>
            <b>{l.role === "reader" ? "You" : "It"}</b> {l.text}
            {!l.done && <i> …</i>}
          </p>
        ))}
      </section>

      <section>
        <h2>Pointed at ({live.pointers.length})</h2>
        {live.pointers.length === 0 && <p className="quiet">It hasn't pointed at anything.</p>}
        {live.pointers.map((p) => (
          <p key={`${p.at}-${p.blockIds.join(",")}`} className="line">
            <b>{p.why || "(no reason given)"}</b> <code>{p.blockIds.join(" ")}</code>
          </p>
        ))}
      </section>

      <section>
        <h2>Tools ({live.tools.length})</h2>
        {live.tools.length === 0 && <p className="quiet">No tools run.</p>}
        {live.tools.map((t) => (
          <p key={t.callId} className="line">
            <b>{t.name}</b> {t.label} — {t.detail} <i>({t.ms}ms)</i>
          </p>
        ))}
      </section>

      <section>
        <h2>Every event seen</h2>
        <pre>
          {Object.entries(live.seen)
            .sort()
            .map(([k, n]) => `${String(n).padStart(4)}  ${k}`)
            .join("\n") || "(none)"}
        </pre>
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Page />);
