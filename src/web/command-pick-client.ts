/**
 * **The command bar asking what a sentence meant** — one post to
 * `POST /api/command-pick`, and the reply read as carefully as the server read
 * the model (src/command-pick.ts § `readPickAnswer`). Plan 261003k, Stage 2.
 *
 * Its own module so the bar's component holds no `fetch`, and so the tests
 * that drive the bar can stand at the network rather than inside it.
 */
import { COMMAND_PICK_PATH, type PickAnswer, type PickRequest, readPickAnswer } from "../command-pick.js";
import { apiFetch } from "./lib/api.js";

/**
 * The answer, or `null` when there is none to be had — a refusal, a timeout,
 * a lost connection, a reply that is not JSON.
 *
 * **One value for every failure, and no sentence from the server**, because
 * the bar says one thing for all of them and for `none`
 * (`COULD_NOT_TELL`): the reader's next move is the same, and the bar's own
 * list is still under their hands. An abort lands here too; the caller has
 * already stopped listening by then.
 */
export async function askForPick(request: PickRequest, signal: AbortSignal): Promise<PickAnswer | null> {
  try {
    const res = await apiFetch(COMMAND_PICK_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
    if (!res.ok) return null;
    return readPickAnswer(JSON.parse(await res.text()) as unknown, request);
  } catch {
    return null;
  }
}
