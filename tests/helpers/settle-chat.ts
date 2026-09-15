/**
 * Let a `useChat` test's chat come to rest, inside `act`.
 *
 * **Draining microtasks is not enough any more.** The chat controller tells
 * React about a change at once, and about any further change in the same
 * browser task only when that task's `setTimeout(0)` fires — which then opens
 * the next window. So a settle that crosses one task boundary can hand the next
 * test action an open window, and the action's first render is lost to it.
 * docs/plans/260915a-question-press-answer-does-not-loop.md § Stages, R4.
 *
 * Two `act` rounds, each draining microtasks and crossing two task boundaries.
 * Between the rounds `act` flushes React's work, which is where an effect that
 * reacts to a notification — the hook's recovery scan, say — dispatches; the
 * second round then carries that dispatch's own window through to its close.
 *
 * Real timers only. tests/use-chat-recovery.test.ts fakes them and keeps its
 * own helper, which advances them a millisecond a round (see its comment).
 */
import { act } from "react";

const task = () => new Promise<void>((go) => setTimeout(go, 0));

async function drain(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

export async function settleChat(): Promise<void> {
  for (let round = 0; round < 2; round += 1) {
    await act(async () => {
      await drain();
      await task();
      await drain();
      await task();
      await drain();
    });
  }
}
