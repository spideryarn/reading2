/**
 * **The add page's High-powered AI tick box** — draws a `HighPowerIntent`
 * (src/web/add-high-power.ts), which holds the state and sends the request.
 * docs/plans/261002k-high-powered-ai-at-import.md.
 *
 * Off by default and never remembered: a remembered tick would double the price
 * of every later import without the reader looking at it again. The price is in
 * articles, never money, in the Metadata switch's own words (HighPowerSwitch.tsx).
 */
import { useSyncExternalStore } from "react";
import { TriangleAlert, Zap } from "lucide-react";

import { isAdmin } from "../admin.js";
import type { HighPowerIntent } from "./add-high-power.js";
import { useSession } from "./useSession.js";

export function AddHighPower({ intent }: { intent: HighPowerIntent }) {
  const { user } = useSession();
  const state = useSyncExternalStore(intent.subscribe, intent.get);
  const exempt = isAdmin(user?.id);

  const checked =
    state.kind === "waiting" ||
    state.kind === "on" ||
    (state.kind === "saving" && state.on) ||
    (state.kind === "refused" && state.on);

  return (
    <div data-add-high-power className="tw:mt-3 tw:text-sm">
      <label className="tw:flex tw:items-start tw:gap-2">
        <input
          type="checkbox"
          className="tw:mt-0.5"
          checked={checked}
          disabled={state.kind === "saving"}
          onChange={(event) => intent.want(event.target.checked)}
        />
        <span>
          <span className="tw:inline-flex tw:items-center tw:gap-1">
            <Zap size={13} className="tw:text-ink-faint" />
            High-powered AI
          </span>
          <span className="tw:block tw:text-muted-foreground">
            A stronger AI model (Claude Opus) for this article — better on difficult pieces.{" "}
            {exempt
              ? "Administrator: no charge."
              : "Counts as one more article against your allowance (half of one while it is shared publicly). Switching off later doesn't give it back."}
          </span>
          <span className="tw:block tw:text-muted-foreground" aria-live="polite">
            {line(state)}
          </span>
        </span>
      </label>
    </div>
  );
}

function line(state: ReturnType<HighPowerIntent["get"]>) {
  switch (state.kind) {
    case "off":
      return null;
    case "waiting":
      return "Will switch on as soon as the import is ready for it.";
    case "saving":
      return "Saving…";
    case "on":
      return state.lateRisk
        ? "On. Some of this import may already have used the standard model — Run it again on the article's Metadata page to redo a mode."
        : "On — later work in this import uses it.";
    case "refused":
      return (
        <span className="tw:inline-flex tw:items-center tw:gap-1 tw:text-highlight-text">
          <TriangleAlert size={12} />
          {state.attempted ? "Not switched on" : "Not switched off"} — {state.message}
        </span>
      );
    case "unknown":
      return (
        <span className="tw:inline-flex tw:items-center tw:gap-1 tw:text-highlight-text">
          <TriangleAlert size={12} />
          Couldn't confirm that — {state.message}
        </span>
      );
    default: {
      const never: never = state;
      return never;
    }
  }
}
