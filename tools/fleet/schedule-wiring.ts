/**
 * The schedule preview's composition in one importable place — the shape
 * `admission-wiring.ts` has, for its reason: `server.ts` cannot be imported
 * without binding its port, so a join test drives this function, which is the
 * one `server.ts` calls, rather than a route the test assembles itself.
 *
 * **A STORE THAT CANNOT BE RESOLVED IS NOT FATAL, AND IS NOT SILENT.** `storeRoot`
 * throws on a relative `OVERSEER_STORE_DIR` (it would mean two stores that
 * cannot see each other). That must not stop the dashboard over one card, so
 * the throw is caught here and the route answers `unreadable` with the reason on
 * every request — the same trade `server.ts` makes around the usage-history
 * store.
 *
 * **The fleet's own `storeRoot` (`attention.ts`), never the Overseer's.**
 * Importing `tools/overseer/store.ts` here pulled sixteen Overseer modules into
 * the dashboard's reach, which is exactly what `tests/fleet-attention.test.ts`
 * § *imports only the Overseer modules that were argued for* exists to refuse:
 * the file is the contract between the two tools, not the Overseer's reader.
 */
import { storeRoot } from "./attention.js";
import { readScheduleFile, scheduleRoute, type ScheduleFileRead, type ScheduleRouteDeps } from "./routes-schedule.js";

export type Schedule = {
  deps: ScheduleRouteDeps;
  route: ReturnType<typeof scheduleRoute>;
  /** The store directory the route reads, or `null` when it could not be resolved. */
  storeDir: string | null;
};

export function makeSchedule(
  options: {
    /** A store directory to read, in place of resolving one. Tests only. */
    storeDir?: string | undefined;
    /** The environment `storeRoot` resolves against. Defaults to this process's. */
    env?: NodeJS.ProcessEnv | undefined;
    nowMs?: (() => number) | undefined;
  } = {},
): Schedule {
  let storeDir: string | null;
  let readFile: () => ScheduleFileRead;
  try {
    const dir = options.storeDir ?? storeRoot(options.env ?? process.env);
    storeDir = dir;
    readFile = () => readScheduleFile(dir);
  } catch (cause) {
    const why = `the Overseer store directory could not be resolved: ${cause instanceof Error ? cause.message : String(cause)}`;
    storeDir = null;
    readFile = () => ({ kind: "unreadable", why });
  }
  const deps: ScheduleRouteDeps = { readFile, nowMs: options.nowMs ?? (() => Date.now()) };
  return { deps, route: scheduleRoute(deps), storeDir };
}
