/**
 * **A step control's card**: what it does, and its key — Skim's ‹ › and the
 * door's *Next stop ›* (plan 260930h), and Quotes' ‹ › since 2026-10-02 (plan
 * 261002h). "While reading" covers keynav's guards, including the Dock drawer
 * suspending the keys while the buttons stay mounted behind it;
 * docs/project/tooltips.md § A shortcut is named on its card.
 */
import type { ReactElement } from "react";
import { ControlTip, Tooltip } from "./Tooltip.js";

export function StepTip({
  head,
  what,
  keyName,
  placement = "bottom",
  enabled = true,
  children,
}: {
  head: string;
  what: string;
  keyName: "←" | "→";
  placement?: "top" | "bottom";
  /** False when the native button is disabled; also closes a card already open. */
  enabled?: boolean;
  children: ReactElement<Record<string, unknown>>;
}) {
  return (
    <Tooltip
      placement={placement}
      keepSide
      className="tip-soon"
      enabled={enabled}
      content={<ControlTip head={head} what={what} how={`While reading, press ${keyName}.`} />}
    >
      {children}
    </Tooltip>
  );
}
