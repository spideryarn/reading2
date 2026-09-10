/**
 * The occurrences routes' composition in one importable place — the shape
 * `schedule-wiring.ts` has, for its reasons: `server.ts` cannot be imported
 * without binding its port, so a join test drives this function, which is the
 * one `server.ts` calls.
 *
 * **A store that cannot be resolved is not fatal, and is not silent**: both
 * routes answer with the reason on every request (the list `unreadable`, the
 * answer a 503), rather than stopping the dashboard over one card.
 *
 * **The fleet's own `storeRoot` (`attention.ts`), never the Overseer's** —
 * `tests/fleet-attention.test.ts` refuses the dashboard any Overseer module
 * that was not argued for; the file is the contract between the two tools.
 */
import { storeRoot } from "./attention.js";
import {
  occurrencesRoute,
  readAnswerFile,
  readOccurrencesFile,
  type AnswerRead,
  type OccurrencesFileRead,
  type OccurrencesRouteDeps,
} from "./routes-occurrences.js";

export type Occurrences = {
  deps: OccurrencesRouteDeps;
  route: ReturnType<typeof occurrencesRoute>;
  /** The store directory the routes read, or `null` when it could not be resolved. */
  storeDir: string | null;
};

export function makeOccurrences(
  options: {
    /** A store directory to read, in place of resolving one. Tests only. */
    storeDir?: string | undefined;
    /** The environment `storeRoot` resolves against. Defaults to this process's. */
    env?: NodeJS.ProcessEnv | undefined;
    nowMs?: (() => number) | undefined;
  } = {},
): Occurrences {
  let storeDir: string | null;
  let readFile: () => OccurrencesFileRead;
  let readAnswer: (launchOccurrenceId: string) => AnswerRead;
  try {
    const dir = options.storeDir ?? storeRoot(options.env ?? process.env);
    storeDir = dir;
    readFile = () => readOccurrencesFile(dir);
    readAnswer = (launchOccurrenceId) => readAnswerFile(dir, launchOccurrenceId);
  } catch (cause) {
    const why = `the Overseer store directory could not be resolved: ${cause instanceof Error ? cause.message : String(cause)}`;
    storeDir = null;
    readFile = () => ({ kind: "unreadable", why });
    readAnswer = () => ({ kind: "unreadable", why });
  }
  const deps: OccurrencesRouteDeps = { readFile, readAnswer, nowMs: options.nowMs ?? (() => Date.now()) };
  return { deps, route: occurrencesRoute(deps), storeDir };
}
