/**
 * The Overseer tab, which now does two real things and refuses to fake a third.
 *
 * Greg, 2026-09-08: *"Add functionality to the Orchestrator tab, e.g. send a
 * message to the Orchestrator (reusing voice-dictation/live-realtime/etc), send
 * a broadcast message to all agents."*
 *
 * ## What is here, and why these two
 *
 * **The broadcast**, which is real: one sentence to every steerable session,
 * each recipient asked to pause for a different length of time. It is the same
 * `BoxActions` component the Box Health tab draws, deliberately — the plan's
 * own words are *"the same mechanism as v0.5c's resource broadcast, so there is
 * one implementation of 'say this to everybody' and not two"*. Two copies would
 * be two places for the stagger to be got wrong, and the stagger is the whole
 * point: thirty-six agents told to pause for an hour all resume in the same
 * second and the box falls over at the far end instead of the near one.
 *
 * **Everything queued, across the fleet**, which is the coordinator's-eye view
 * and is the thing this tab was actually missing. What is about to be said, to
 * whom, in what order — none of it sent yet, all of it cancellable. A decision
 * log would be the other half and nothing emits one; this half exists today.
 *
 * ## What is NOT here, and is said rather than mocked
 *
 * **A box to send the Overseer a message.** There is no Overseer process: the
 * direction doc's status line for 2026-09-08 is *"the dashboard is running, the
 * Overseer is not"*, there is no `tools/overseer/`, no store, and no route that
 * would receive such a message. A textarea over that would be the most
 * expensive lie this tool can tell — a page whose whole claim is that what it
 * shows is true, quietly swallowing instructions into nothing. So the card
 * below says where the message would go when there is something to receive it,
 * and the Sessions tab is where a sentence reaches an agent today.
 *
 * The roadmap list stays, because knowing the shape of what is coming is worth
 * a paragraph — and it is prose, so it will go stale, which is why nothing on
 * the page computes anything from it.
 */
import type { ReactNode } from "react";

import { BoxActionsCard, FleetQueues } from "./ActionButtons";
import type { FleetRow } from "./types";
import type { ActionsUi } from "./useActions";
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
  { stage: "v0.2", what: "Send a steering message to one session, by tmux keystroke.", state: "done" },
  { stage: "v0.4b", what: "Pick a session and see it at length: answer it, or say something to it.", state: "done" },
  { stage: "v0.6", what: "Start an agent, through gjd-remote rather than a second way. Killing is not built.", state: "done" },
  { stage: "v0.5", what: "The recurring instructions as buttons, queued rather than raced.", state: "done" },
  { stage: "v0.5c", what: "Box Health can act: kill what is safe, kill the suites, broadcast.", state: "done" },
  { stage: "v0.4c", what: "Recent messages, from the tail of a session's own transcript.", state: "next" },
  { stage: "v0.7", what: "The decision log: what was decided for you, and how sure the model was.", state: "later" },
  { stage: "—", what: "The Overseer itself: a daemon, a store, and a session spawned to judge.", state: "later" },
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

export function OrchestratorPanel({ actions, rows }: { actions: ActionsUi; rows: readonly FleetRow[] }): ReactNode {
  /* Handle → title, so a queue can be labelled with the thing a person
     recognises. Built from the latest snapshot; a queue whose session is not in
     it is still drawn, and says so, because an item waiting for a session
     nobody can see is the most interesting one on the page. */
  const titles = new Map<string, string>();
  for (const row of rows) if (row.title !== null) titles.set(row.id, row.title);

  return (
    <div>
      <Card className="tw:p-4">
        <h2 className="tw:font-medium">Everything queued, across the fleet</h2>
        <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
          What is about to be said to whom, in the order it will be said. Nothing here has been sent: each item goes
          when its session is next at a prompt, and any of it can be cancelled until then.
        </p>
        <FleetQueues
          feed={actions.feed}
          api={actions.api}
          asked={actions.asked}
          error={actions.error}
          titles={titles}
          onChanged={actions.refresh}
        />
      </Card>

      {/* The same component Box Health draws. One implementation of "say this
          to everybody", per the plan. */}
      <BoxActionsCard
        feed={actions.feed}
        api={actions.api}
        asked={actions.asked}
        error={actions.error}
        onChanged={actions.refresh}
      />

      <Card className="tw:mt-3 tw:border-l-4 tw:border-l-unknown tw:p-4">
        <h2 className="tw:font-medium">There is nothing yet to send a message to.</h2>
        <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
          The Overseer — the agent whose job is to watch the other sessions — is not running, and there is nothing on
          this box that would receive a message addressed to it. A box here would swallow what you typed and look
          like it had worked, which is the one thing this page is built not to do. To say something to a particular
          agent, use its session on the Sessions tab; to say something to all of them, the broadcast above is the
          real thing.
        </p>
        <p className="tw:mt-2 tw:text-[13px] tw:text-ink-faint">
          When it lands it is a daemon, a store and a short-lived session spawned to make a judgement — the store
          first, because ranking by <em>who has needed me longest</em> needs a duration and nothing on this box
          records one. docs/project/orchestrator-direction.md.
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
