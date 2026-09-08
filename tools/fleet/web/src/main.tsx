/**
 * The entry point. Mounts the app, and imports the ONE stylesheet.
 *
 * `tailwind.css` and nothing else — the same rule the product states in
 * src/web/main.tsx, and for the same reason: a second stylesheet imported
 * beside it lands unlayered, outranks every Tailwind utility, and the utilities
 * silently do nothing.
 *
 * `StrictMode` is on. It double-invokes effects in development, which is
 * exactly the pressure the polling transport should be under — `stop()` has to
 * be idempotent and a teardown must actually stop the timer, and a page that
 * quietly ran two polls would look identical to one that ran one.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./tailwind.css";

const host = document.getElementById("root");
if (host === null) {
  // Not a silent failure: a missing mount point means index.html and this file
  // have come apart, and a blank page with a clean console is the worst way to
  // find that out.
  throw new Error("tools/fleet/web/index.html has no #root element to mount into");
}

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
