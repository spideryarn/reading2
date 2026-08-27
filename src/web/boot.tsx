/**
 * The page's entry point, and it does exactly two things in exactly this order.
 *
 * ## Why this file exists at all
 *
 * The obvious place to start Sentry is the first line of `main.tsx`, and that
 * is where the first version of this put it. It does not work, for a reason
 * that is easy to state and easy to miss:
 *
 * > All static imports — including `App` — evaluate **before** the first
 * > statement of the importing module runs.
 * >
 * > — GPT Sol's review, 2026-08-27
 *
 * `main.tsx` imports `App`, which imports most of the client. So a module that
 * throws while *evaluating* — a bad `import.meta.env` read at module scope, a
 * circular import resolving to `undefined`, a missing export after a rename —
 * takes the page down before `Sentry.init` has been reached. That is precisely
 * the blank-page failure this app has already had once in production
 * (`www.spideryarn.com`, 2026-08-26, `src/web/lib/supabase.ts` throwing at
 * module load because two build-time variables were unset). **The one failure
 * we most wanted reported was the one the obvious placement could never see.**
 *
 * A dynamic `import()` is the fix and the whole of it: it is evaluated when the
 * expression runs, not when this module is linked, so everything it pulls in is
 * inside `initClientMonitoring`'s reach — and inside the `catch` below.
 *
 * So: **nothing else may be statically imported here.** A convenience import
 * added later would quietly re-open the hole, which is why this file is four
 * lines of code and thirty of comment.
 */
import { captureClientFailure, initClientMonitoring } from "./monitoring.js";

initClientMonitoring();

import("./main.js").catch((err: unknown) => {
  /* The app never started. There is no React, so there is no error boundary
     and nothing has been drawn — `#root` is empty and the tab is a blank
     coloured rectangle.

     Report it, then say something, in that order: the report is the only record
     that will outlive the tab, and `document.body` is the only surface left. */
  captureClientFailure(err, { boundary: "boot" });
  const root = document.getElementById("root");
  if (root) {
    /* `textContent`, never `innerHTML`. What is being written here is a string
       we chose, but this is the code path that runs when assumptions have
       already failed, and it is not the place to hand a parser anything. */
    root.textContent =
      "Spideryarn couldn’t start. That’s a fault here, not anything you did. [boot]";
    root.setAttribute("role", "alert");
    root.setAttribute("style", "max-width:32rem;margin:4rem auto;padding:0 1.5rem;text-align:center");
  }
});
