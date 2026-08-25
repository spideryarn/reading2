import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { LucideProvider } from "lucide-react";
import { App } from "./App.js";
import { isSpideryarnId } from "../ids.js";
// The entry stylesheet, and the ONLY one imported here. It pulls in
// styles.css inside `@layer app` — importing the two side by side would
// leave styles.css unlayered, where it silently outranks every Tailwind
// utility. See the header of tailwind.css.
import "./tailwind.css";

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

/**
 * Icon defaults for the whole app — see docs/project/icons.md.
 *
 * Set once here rather than at every call site, so the chrome stays one weight.
 * 16px against a 0.82rem UI face, and a stroke thinner than Lucide's default 2,
 * because on the dark ground a 2px stroke reads as bold: the icons are meant to
 * sit behind the prose, not compete with it.
 */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LucideProvider size={16} strokeWidth={1.75}>
      <NuqsAdapter>
        <App />
      </NuqsAdapter>
    </LucideProvider>
  </StrictMode>,
);
