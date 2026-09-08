/**
 * The Orchestrator tab, which is empty on purpose.
 *
 * **Nothing here is a mock.** There is no decision log, no steering vocabulary
 * and no coordinator; a panel that drew a plausible-looking one would be the
 * most expensive kind of lie this project can tell, because the whole point of
 * the dashboard is that what it shows is true. So the tab exists — it is worth
 * knowing the shape of what is coming, and a tab is cheaper to add now than a
 * navigation rethink later — and it says plainly that it is not built.
 *
 * The content is a summary of docs/project/orchestrator-direction.md and
 * docs/plans/260907e-agent-fleet-dashboard.md § Stages, with the direction
 * doc's own framing kept: **the orchestrator is eventually a coordinator agent,
 * not a person with a mouse** (Greg, 2026-09-08). Which is why every steering
 * action gets a typed function before it gets a button.
 */
import type { ReactNode } from "react";

import { Card } from "./ui";

/** One line of the roadmap. `state` is what the page can honestly claim today. */
type Step = { stage: string; what: string; state: "done" | "next" | "later" };

/**
 * Where the work actually is.
 *
 * **This list is prose and it will go stale**, which is why nothing on the page
 * computes anything from it and why each line names the stage it comes from.
 * The plan doc is the source; this is a signpost to it.
 */
const STEPS: Step[] = [
  { stage: "v0.1", what: "A page listing the sessions, read-only.", state: "done" },
  { stage: "v0.3", what: "Status: working, idle, blocked — and why.", state: "done" },
  { stage: "v0.4", what: "What a blocked session is asking, read off its pane.", state: "done" },
  { stage: "v0.2", what: "Send a steering message to one session, by tmux keystroke.", state: "next" },
  { stage: "v0.5", what: "The recurring instructions as buttons rather than free text.", state: "later" },
  { stage: "v0.6", what: "Create and kill agents, through gjd-remote rather than a second way.", state: "later" },
  { stage: "v0.7", what: "The decision log: what was decided for you, and how sure the model was.", state: "later" },
];

const STATE_LABEL: Record<Step["state"], string> = {
  done: "built",
  next: "next",
  later: "later",
};

const STATE_CLASS: Record<Step["state"], string> = {
  done: "tw:text-work-ink",
  next: "tw:text-needs-ink",
  later: "tw:text-ink-faint",
};

export function OrchestratorPanel(): ReactNode {
  return (
    <div>
      <Card className="tw:border-l-4 tw:border-l-unknown tw:p-4">
        <h2 className="tw:font-medium">There is no orchestrator yet.</h2>
        <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
          This tab is a placeholder and shows nothing real. Everything on this page today is
          read-only: it can tell you a session is blocked and what it is asking, and it cannot
          answer for you.
        </p>
      </Card>

      <Card className="tw:mt-3 tw:p-4">
        <h2 className="tw:font-medium">What it is meant to become</h2>
        <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
          A coordinator <em>agent</em> rather than a person with a mouse — Greg&rsquo;s call on
          2026-09-08. That is why the steering actions are being built as typed functions first and
          buttons second: something has to be able to call them that is not a hand.
        </p>
        <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
          It would keep going or pause a session, pull the latest changes, tell an agent the box is
          short of resources, harmonise two agents working near each other, remove a worktree, and
          create or kill sessions through <code className="tw:font-mono">gjd-remote</code>. Beside
          that, a log of the decisions made on Greg&rsquo;s behalf, ranked by how much they matter
          and how sure the model was.
        </p>
        <p className="tw:mt-2 tw:text-[13px] tw:text-ink-faint">
          The direction is docs/project/orchestrator-direction.md; the stages are
          docs/plans/260907e-agent-fleet-dashboard.md.
        </p>
      </Card>

      <Card className="tw:mt-3 tw:p-4">
        <h2 className="tw:font-medium">The slices</h2>
        <ul className="tw:mt-2 tw:space-y-2">
          {STEPS.map((step) => (
            <li key={step.stage + step.what} className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2">
              <span className="tw:font-mono tw:text-[12px] tw:text-ink-faint">{step.stage}</span>
              <span className="tw:min-w-0 tw:flex-1 tw:text-[13px] tw:text-ink-soft">{step.what}</span>
              <span className={`tw:text-[11px] tw:tracking-wide tw:uppercase ${STATE_CLASS[step.state]}`}>
                {STATE_LABEL[step.state]}
              </span>
            </li>
          ))}
        </ul>
        <p className="tw:mt-3 tw:text-[12px] tw:text-ink-faint">
          Written by hand and therefore able to go stale. The plan doc is what is true.
        </p>
      </Card>
    </div>
  );
}
