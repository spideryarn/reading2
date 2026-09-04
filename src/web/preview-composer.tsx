/**
 * **The chat composer, at three widths, with nothing behind it.**
 *
 * A throwaway page whose entire purpose is that it is **not behind the auth
 * gate**. A browser agent cannot sign in — that is browser chrome, not page
 * content — so the real composer inside the real app is unreachable to an
 * automated pass, and the one thing tests cannot check about a row of controls
 * is whether it fits. jsdom will tell you the button rendered; it will not tell
 * you the Send button wrapped onto its own line at 400px.
 * docs/project/browser-testing.md, and the same trick `preview-profile.tsx` uses.
 *
 * The live session is a **fake object**, not the hook: this page must never
 * open a realtime connection, which costs money and needs a microphone
 * permission nobody here can grant. Every phase the button can be in is a
 * column instead, so all of them are visible at once rather than one at a time
 * behind a control you would have to press.
 *
 *   npm run dev  →  http://localhost:<vite's port>/preview-composer.html
 *
 * `localhost`, not `127.0.0.1`: vite binds IPv6, so the numeric form refuses
 * the connection on a perfectly healthy server.
 */
import { createRoot } from "react-dom/client";

import { Composer } from "./ChatPanel.js";
/* **The app's stylesheet, and the page is worthless without it.** This file
   existed for half an hour without these two lines, and it rendered the real
   `Composer` as unstyled browser defaults: `display: block` instead of the flex
   row, no tokens, no button sizing. It *looked* like a working preview, and the
   only thing it could have told anybody about layout was wrong — which is
   exactly the shape of check this repo keeps writing up
   (docs/reusable/silent-success.md). Caught by the browser pass it was built
   for, which read `document.styleSheets` rather than trusting the picture.
   Both, and in this order, matching `preview-profile.tsx`. */
import "./tailwind.css";
import type { LiveApi, LivePhase } from "./live/useLiveConversation.js";

/** A live session that does nothing at all. See the header. */
function still(phase: LivePhase, over: Partial<LiveApi> = {}): LiveApi {
  return {
    phase,
    error: null,
    lines: [],
    pointers: [],
    tools: [],
    hearing: false,
    speaking: false,
    seen: {},
    placement: { placement: "laptop", from: "guessed", label: "MacBook Pro Microphone" },
    threadId: "spya-k3m9qt",
    start: () => {},
    stop: () => Promise.resolve(),
    say: () => {},
    ...over,
  };
}

/** The widths that matter: the dock, a narrow dock, and Remember's full width. */
const WIDTHS = [
  { px: 400, what: "the dock, as it usually is" },
  { px: 320, what: "the dock, squeezed" },
  { px: 680, what: "Remember, full width" },
];

const PHASES: { phase: LivePhase; what: string; over?: Partial<LiveApi> }[] = [
  { phase: "idle", what: "idle" },
  { phase: "connecting", what: "connecting" },
  { phase: "live", what: "live, hearing you", over: { hearing: true } },
  { phase: "live", what: "live, speaking", over: { speaking: true } },
  { phase: "closing", what: "hanging up" },
];

function Page() {
  return (
    <main>
      <h1>The chat composer, with the Live button in it</h1>
      <p className="sub">
        Nothing here is connected to anything. What to look at: whether the row still fits, whether
        Send stays on it, and whether Live sits beside the microphone as though it belongs.
      </p>

      {WIDTHS.map((w) => (
        <section key={w.px}>
          <h2>
            {w.px}px — {w.what}
          </h2>
          {PHASES.map((p) => (
            <div className="case" key={`${p.phase}-${p.what}`}>
              <span className="what">{p.what}</span>
              {/* The panel's own class, so the composer inherits the widths and
                  the orders the real one does. `.remember` on the last column,
                  which is what makes the box six rows tall and labels the two
                  talking controls. */}
              <div
                className={`chat-panel${w.px > 500 ? " remember" : ""}`}
                style={{ width: `${w.px}px` }}
              >
                <Composer
                  slug="preview"
                  onSend={() => {}}
                  busy={false}
                  focusNonce={0}
                  focused={{ current: 0 }}
                  draft=""
                  onDraft={() => {}}
                  kind={w.px > 500 ? "remember" : "chat"}
                  live={still(p.phase, p.over ?? {})}
                  onStartLive={() => {}}
                />
              </div>
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Page />);
