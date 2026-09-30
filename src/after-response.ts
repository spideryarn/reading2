/**
 * Small, request-scoped queue for work that must keep a serverless invocation
 * alive but must not sit in front of the HTTP response.
 *
 * `handleApi` wraps the whole routed request in `withAfterResponseTasks`. A
 * caller below it gives `afterResponse` a thunk; the thunk does not start until
 * routing has returned, which means ordinary JSON responses and awaited SSE
 * streams have both called `res.end`. The wrapper then awaits every task so
 * Vercel cannot freeze the instance halfway through one.
 *
 * Outside that wrapper (a CLI or a focused unit test), `afterResponse` runs and
 * awaits the task immediately. That keeps the default path real rather than
 * making non-HTTP callers silently drop work.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { errorFields, log } from "./log.js";

interface DeferredTask {
  readonly label: string;
  readonly run: () => Promise<unknown>;
}

interface TaskScope {
  readonly tasks: DeferredTask[];
}

const scope = new AsyncLocalStorage<TaskScope>();
const logger = log("http");

/** Run one deferred task without ever letting it change the request's result. */
async function settle(task: DeferredTask): Promise<void> {
  try {
    await task.run();
  } catch (err) {
    logger.error({ label: task.label, ...errorFields(err) }, "work after the response failed");
  }
}

/**
 * Run a request and keep its invocation alive until all work queued by it has
 * settled. Tasks are started together after the request callback returns.
 */
export function withAfterResponseTasks<T>(fn: () => Promise<T>): Promise<T> {
  return scope.run({ tasks: [] }, async () => {
    const box = scope.getStore();
    if (!box) throw new Error("after-response task scope was not created");

    try {
      return await fn();
    } finally {
      /* A task may itself queue more work. Drain in batches so that work is not
         silently abandoned, while unrelated tasks in one batch run together. */
      while (box.tasks.length > 0) {
        const batch = box.tasks.splice(0);
        await Promise.all(batch.map(settle));
      }
    }
  });
}

/**
 * Queue work for after this request's response. With no request wrapper, run it
 * now and await it; in either case a rejection is logged and swallowed.
 */
export async function afterResponse(label: string, run: () => Promise<unknown>): Promise<void> {
  const box = scope.getStore();
  if (box) {
    box.tasks.push({ label, run });
    return;
  }
  await settle({ label, run });
}
