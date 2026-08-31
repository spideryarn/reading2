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
import type { LiveWiring } from "./live/wiring.js";
import {
  PLACEMENT_LABEL,
  rememberPlacement,
  rememberedPlacement,
  type MicPlacement,
} from "./live/mic-placement.js";

const SLUG =
  new URLSearchParams(location.search).get("slug") ?? "noema-mythology-of-conscious-ai";

/** Where the spike's server is. scripts/live-spike.ts. */
const SPIKE = "http://127.0.0.1:5399";

/**
 * **The spike server, in place of the app's own API** — and that is this page's
 * entire reason to exist.
 *
 * The real routes are behind the auth gate, and a browser agent cannot get
 * through one (docs/project/browser-testing.md). So the hook takes its two
 * server calls as an argument and this supplies the unauthenticated pair. What
 * is being tested — the SDP exchange, the data channel, the event names, the
 * ledger, the tool loop — is the shipping code either way.
 *
 * There is no `speak`: there is no chat controller on this page and nothing to
 * write into. The transcript below is the point here; in the app it is the
 * thread. That difference is the one thing this page cannot check, which is
 * what tests/chat-spoken-route.test.ts and tests/chat-spoken-operation.test.ts
 * are for.
 */
const spikeWiring: LiveWiring = {
  async ticket(slug, _threadId, placement) {
    const res = await fetch(`${SPIKE}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, placement }),
    });
    const body = (await res.json()) as { token?: string; error?: string; model?: string };
    if (!res.ok || !body.token) {
      throw new Error(body.error ?? `could not start a session (${res.status})`);
    }
    /* No history and no tail: this page has no conversation behind it, so the
       seeding barrier lifts immediately. That is a real difference from the app
       and is why the barrier has its own tests rather than being checked here. */
    return { token: body.token, expiresAt: 0, model: body.model ?? "", seed: [], tailId: null };
  },
  async runTool(slug, name, args) {
    const res = await fetch(`${SPIKE}/tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, name, args }),
    });
    const out = (await res.json()) as { content?: string; label?: string; detail?: string };
    if (!res.ok) throw new Error(out.label ?? `tool failed (${res.status})`);
    return { content: out.content ?? "", label: out.label ?? name, detail: out.detail ?? "" };
  },
};

/** A conversation id this page invents and nothing ever stores. */
const THREAD = "spya-preview";

function Page() {
  const live = useLiveConversation(SLUG, { wiring: spikeWiring });
  const [typed, setTyped] = useState("");
  /* `null` means "let it work it out" — which is a real third option, not an
     absent value, so the select has three entries rather than a checkbox. */
  const [chosen, setChosen] = useState<MicPlacement | null>(() => rememberedPlacement());
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
        <button type="button" onClick={() => live.start({ threadId: THREAD, microphone: true })} disabled={busy}>
          Talk (needs the mic)
        </button>
        <button type="button" onClick={() => live.start({ threadId: THREAD, microphone: false })} disabled={busy}>
          Connect silently
        </button>
        <button type="button" onClick={() => void live.stop()} disabled={live.phase !== "live"}>
          Hang up
        </button>

        {/* **The microphone's placement, which is the reader's fact and not
            ours.** It picks `near_field` or `far_field` noise reduction, which
            runs before the voice-activity detector and therefore decides how
            often a room gets treated as somebody talking.

            Disabled while connected, because it is baked into the session at
            mint time — a control that appears to work and changes nothing is
            worse than one that is plainly unavailable. */}
        <label className="placement">
          <span>Mic</span>
          <select
            value={chosen ?? "auto"}
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value;
              const next = v === "auto" ? null : (v as MicPlacement);
              setChosen(next);
              rememberPlacement(next);
            }}
          >
            <option value="auto">Work it out</option>
            <option value="headset">{PLACEMENT_LABEL.headset}</option>
            <option value="laptop">{PLACEMENT_LABEL.laptop}</option>
          </select>
        </label>
      </div>

      {/* What it actually used, and where that came from. A guess the reader
          cannot see is a guess they cannot correct. */}
      {live.placement && (
        <p className="quiet">
          Using <b>{PLACEMENT_LABEL[live.placement.placement]}</b>{" "}
          {live.placement.from === "chosen"
            ? "because you said so"
            : live.placement.from === "guessed"
              ? `guessed from "${live.placement.label}"`
              : "as a fallback — grant the microphone once and it can read the device name"}
        </p>
      )}

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
