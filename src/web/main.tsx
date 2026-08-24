import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { App } from "./App.js";
import { isSpideryarnId } from "../ids.js";
import "./styles.css";

/**
 * The browser must not try to restore scroll itself.
 *
 * By default it remembers a pixel offset across reload and back/forward and
 * reapplies it — which here is both wrong and late. Wrong, because the offset
 * was measured against whichever granularity columns happened to be open, and
 * every row changes height when those change. Late, because it lands after our
 * own restore and so wins, producing a visible jump to the wrong place. The URL
 * is the only thing that knows where the reader was; let it be the only thing
 * that decides. See src/web/position.ts.
 */
history.scrollRestoration = "manual";

/**
 * Deep links used to be `/#spya-k6fpme`; position now lives in `?at=`.
 *
 * Rewritten before React mounts, for the same reason the hash was abandoned:
 * blocks carry their id in the HTML, so left in place the browser would scroll
 * to the block on its own, and then our restore would scroll again to offset it
 * under the sticky bars. Old links keep working; they just arrive in the new
 * spelling.
 */
const legacyAnchor = decodeURIComponent(location.hash.slice(1));
if (isSpideryarnId(legacyAnchor)) {
  const url = new URL(location.href);
  url.hash = "";
  if (!url.searchParams.has("at")) url.searchParams.set("at", legacyAnchor);
  history.replaceState(history.state, "", url);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NuqsAdapter>
      <App />
    </NuqsAdapter>
  </StrictMode>,
);
