/**
 * **A page that reloads itself when a new build is live** — and `/changelog`
 * is the only one that does.
 *
 * Greg, 2026-10-04 (spya-ym9dum), from `/changelog`: *"Could you set this page
 * to somehow poll every 15 minutes or so, and if there's a new version, then
 * refresh the page."* The list of releases is compiled into the bundle, so a
 * copy of the app that has been open for days shows an old list and nothing
 * told it there was a newer one.
 *
 * The polling is not here: stale-shell.ts § `watchForDeploy` asks for the whole
 * app, on waking and every fifteen minutes. This listens to it and makes one
 * decision each time it speaks — stale-shell.ts § `reloadForNewBuild`, which
 * has the refusals: hidden, gone to another page, something unsent that a
 * reload would lose (safe-to-reload.ts), already reloaded for this build. A
 * refusal waits for the watcher's next answer; nothing here retries on its own.
 *
 * **Not for an article.** An unasked reload under somebody mid-sentence is not
 * what was asked for, and the plan says why no other page has this:
 * docs/plans/261005d-notice-a-deploy-on-wake-and-reload-the-changelog.md.
 */
import { useEffect } from "react";

import { parseRoute } from "./router.js";
import { safeToReload } from "./safe-to-reload.js";
import {
  onDeployNoticed,
  reloadForNewBuild,
  reloadPage,
  sessionNote,
  type ReloadForNewBuildDeps,
} from "./stale-shell.js";

/** Everything the hook touches, so a test can stand in for any of it. */
export interface ReloadForNewBuildSource extends ReloadForNewBuildDeps {
  /** stale-shell.ts § `DeployWatch.subscribe`: told now, and after every answered check. */
  subscribe: (listener: (build: string | null) => void) => () => void;
}

const THE_BROWSER: Partial<ReloadForNewBuildSource> = {};

export function useReloadForNewBuild(over: Partial<ReloadForNewBuildSource> = THE_BROWSER): void {
  useEffect(() => {
    /* The address can move before this page's passive effect runs. Always
       check the page that owns this hook, rather than adopting that address. */
    const deps: ReloadForNewBuildDeps = {
      visible: () => document.visibilityState === "visible",
      onPage: () => parseRoute(window.location.pathname).kind === "changelog",
      safe: safeToReload,
      storage: sessionNote(),
      reload: reloadPage,
      ...over,
    };
    return (over.subscribe ?? onDeployNoticed)((build) => {
      reloadForNewBuild(build, deps);
    });
  }, [over]);
}
