/**
 * Starting a session from the page — `POST /api/sessions/new`, then poll.
 *
 * ## Three states, and the client must not flatten them
 *
 * The route answers **202, never 200**, because at the moment it answers
 * nothing has succeeded: `gjd-remote new-claude` takes tens of seconds and runs
 * on after the response. So a launch is `starting`, and later `started` or
 * `failed` — read back from `GET /api/sessions/new`.
 *
 * **`failed` with `maybeStarted: true` is the state everything else here is
 * arranged around.** It is what a timeout, or a launcher that vanished
 * mid-run, leaves behind: we lost the answer rather than got a refusal, so a
 * session may well exist. The honest sentence is *check the list and kill it if
 * it is there*, and a panel that rendered that as "nothing happened" would be
 * wrong about exactly the case that costs something — a Claude process nobody
 * knows they started, on a box that hit load 391 the day this was written.
 * docs/reusable/silent-success.md.
 *
 * ## `name` is deliberately not sent
 *
 * Omitting it makes gjd-remote start Claude without `--name`, so Claude titles
 * the conversation itself and the list adopts that title. A name we chose here
 * would freeze a placeholder over the top of it forever. `dir` is omitted for
 * the same kind of reason: the server has a default and an allowlist, and a
 * directory picker is not what Greg asked for.
 *
 * ## Where the failure sentences come from
 *
 * This route spells its refusal `{ok: false, error}` where the steering routes
 * spell theirs `{ok: false, code, why}`. Both are read, `why` first, because
 * the sentence is the point and which key it arrived under is not. Noted rather
 * than fixed here: `routes-new.ts` is not this agent's file.
 */

export const NEW_SESSION_URL = "api/sessions/new";

export type LaunchState = "starting" | "started" | "failed";

/** One attempt, from the moment it was accepted to whatever became of it. */
export type LaunchRecord = {
  id: string;
  state: LaunchState;
  /** What gjd-remote said it made. Null while starting, since Claude names it. */
  name: string | null;
  dir: string;
  /** The prompt's size. The server never records the prompt, and neither do we. */
  promptBytes: number;
  requestedAt: string;
  finishedAt: string | null;
  /** Why it failed, in a sentence for a person. */
  error: string | null;
  /** **A failure that may have started something.** See the header. */
  maybeStarted: boolean;
  /** Anything true but awkward — a start whose name could not be read back. */
  note: string | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * A launch record off the wire.
 *
 * A state this build has never heard of is refused rather than rounded to one
 * of the three — the same decision `parseStatus` makes about a session status,
 * and for the same reason: a fourth state rendered as `started` would be a
 * claim nobody made.
 */
export function parseLaunch(v: unknown): LaunchRecord | null {
  if (!isRecord(v)) return null;
  const id = str(v["id"]);
  const state = str(v["state"]);
  if (id === null) return null;
  if (state !== "starting" && state !== "started" && state !== "failed") return null;
  return {
    id,
    state,
    name: str(v["name"]),
    dir: str(v["dir"]) ?? "",
    promptBytes: typeof v["promptBytes"] === "number" ? v["promptBytes"] : 0,
    requestedAt: str(v["requestedAt"]) ?? "",
    finishedAt: str(v["finishedAt"]),
    error: str(v["error"]),
    /* `=== true` rather than truthiness: an absent field must read as "we know
       nothing was started", and the honest default for a field the server did
       not send is the one that does not invent a warning. */
    maybeStarted: v["maybeStarted"] === true,
    note: str(v["note"]),
  };
}

/** What `GET /api/sessions/new` says. */
export type LaunchFeed = { busy: boolean; retryAfterMs: number; launches: LaunchRecord[] };

export function parseLaunchFeed(v: unknown): LaunchFeed | null {
  if (!isRecord(v)) return null;
  const launches: LaunchRecord[] = [];
  if (Array.isArray(v["launches"])) {
    for (const item of v["launches"]) {
      const one = parseLaunch(item);
      if (one !== null) launches.push(one);
    }
  }
  return {
    busy: v["busy"] === true,
    retryAfterMs: typeof v["retryAfterMs"] === "number" && v["retryAfterMs"] > 0 ? v["retryAfterMs"] : 0,
    launches,
  };
}

/**
 * What became of a POST.
 *
 * `accepted` rather than `ok`, because the word matters: the request was taken,
 * and that is all that has happened. The session may still fail to start.
 */
export type StartOutcome =
  | { accepted: true; launch: LaunchRecord | null }
  | { accepted: false; why: string; status: number | null; from: "server" | "client" };

export type PollOutcome = { ok: true; feed: LaunchFeed } | { ok: false; why: string };

export type NewSessionApi = {
  start: (prompt: string) => Promise<StartOutcome>;
  poll: () => Promise<PollOutcome>;
};

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message === "" ? cause.name : cause.message;
  if (typeof cause === "string" && cause !== "") return cause;
  return "the request failed, and gave no reason";
}

/** The server's sentence, under whichever key this route spells it. */
function whyOf(parsed: unknown): string | null {
  if (!isRecord(parsed)) return null;
  return str(parsed["why"]) ?? str(parsed["error"]);
}

export function makeNewSessionApi(fetchImpl: typeof fetch = fetch): NewSessionApi {
  return {
    async start(prompt: string): Promise<StartOutcome> {
      let response: Response;
      try {
        response = await fetchImpl(NEW_SESSION_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          // ONE KEY. See the header: no `name`, so Claude titles it, and no
          // `dir`, so the server's default and its allowlist decide.
          body: JSON.stringify({ prompt }),
        });
      } catch (cause) {
        return {
          accepted: false,
          why: `this browser could not reach the dashboard: ${describe(cause)}`,
          status: null,
          from: "client",
        };
      }

      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }

      /* **202 and nothing else.** A 200 here would mean the route had started
         waiting for the launch, and a client that accepted it would be
         reporting a success the server never claimed. Saying so out loud beats
         inheriting whatever a future 200 means. */
      if (response.status === 202) {
        return { accepted: true, launch: isRecord(parsed) ? parseLaunch(parsed["launch"]) : null };
      }
      if (response.ok) {
        return {
          accepted: false,
          why: `the server answered ${response.status}, and this page only accepts 202 — a launch has three states and a 200 would be claiming one of them early`,
          status: response.status,
          from: "client",
        };
      }
      const why = whyOf(parsed);
      return {
        accepted: false,
        why: why ?? `the server answered ${response.status} without saying why`,
        status: response.status,
        from: why === null ? "client" : "server",
      };
    },

    async poll(): Promise<PollOutcome> {
      try {
        const response = await fetchImpl(NEW_SESSION_URL, { cache: "no-store" });
        const parsed: unknown = await response.json();
        if (!response.ok) {
          return { ok: false, why: whyOf(parsed) ?? `the server answered ${response.status}` };
        }
        const feed = parseLaunchFeed(parsed);
        if (feed === null) return { ok: false, why: "the server answered something that is not this API" };
        return { ok: true, feed };
      } catch (cause) {
        return { ok: false, why: describe(cause) };
      }
    },
  };
}

/** The default instance. Late-bound `fetch`, for the reason in steer-client.ts. */
export const httpNewSessionApi: NewSessionApi = {
  start: (prompt) => makeNewSessionApi().start(prompt),
  poll: () => makeNewSessionApi().poll(),
};
