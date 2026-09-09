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

import type { LaunchProgress, LaunchRecordView, NotifyState } from "../../wire.js";

export const NEW_SESSION_URL = "api/sessions/new";

/**
 * THE LAUNCH RECORD IS SHARED NOW — this file used to declare its own.
 *
 * It was a twin of the one in `routes-new.ts`, related by nothing but hope, and
 * `parseLaunch` below read the discriminant as a raw string. So a shape change
 * on the server was invisible to the compiler and would have surfaced here as
 * `parseLaunch` returning `null` for every record and the panel rendering
 * nothing — `QueueView`'s failure exactly, and the reason `wire.ts` exists.
 *
 * **The parse stays.** Sharing the TYPE is not sharing trust: this is still
 * untrusted JSON off the wire, and `parseLaunch` still refuses a shape it does
 * not recognise rather than casting. What the shared type buys is that a change
 * to the shape turns BOTH ends red instead of neither.
 */
export type LaunchRecord = LaunchRecordView;
export type LaunchState = LaunchProgress["state"];
export type LaunchResolution = LaunchRecordView["resolution"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * The launch's state and its notification, which travel together.
 *
 * **A state this build has never heard of is refused rather than rounded to one
 * of the three** — the same decision `parseStatus` makes about a session status
 * and for the same reason: a fourth state drawn as `started` would be a claim
 * nobody made. The notification is parsed the same way, and an unreadable one
 * does NOT sink the whole record: the launch itself is the news, and losing it
 * because we could not read a footnote about a message would be the tail
 * wagging. It becomes `cannot-tell` instead, which is a true statement.
 */
export function parseProgress(v: unknown): LaunchProgress | null {
  if (!isRecord(v)) return null;
  const state = str(v["state"]);
  const notification = parseNotification(v["notification"]);
  if (state === "starting") return { state, notification: { kind: "not-attempted" } };
  if (state === "failed") return { state, notification: { kind: "not-applicable" } };
  if (state !== "started") return null;
  return {
    state,
    notification:
      notification === null
        ? { kind: "cannot-tell", why: "this page could not read what the server said about the notification" }
        : notification,
  };
}

/** What became of the line the dashboard sends the Overseer. Never "sent". */
function parseNotification(v: unknown): NotifyState | null {
  if (!isRecord(v)) return null;
  const kind = str(v["kind"]);
  const to = str(v["to"]);
  const why = str(v["why"]) ?? "";
  switch (kind) {
    case "pending":
      return { kind };
    case "no-holder":
      return { kind };
    case "contested": {
      const names = Array.isArray(v["names"]) ? v["names"].filter((n): n is string => typeof n === "string") : [];
      return { kind, names };
    }
    case "cannot-tell":
      return { kind, why };
    case "queued": {
      const position = v["position"];
      if (to === null || typeof position !== "number") return null;
      return { kind, to, position };
    }
    case "not-queued": {
      /* `rule` travels rather than being flattened into `why`: a full queue is
         a fact about THIS recipient and `bad-text` is a fact about the MESSAGE,
         and a page that could not tell them apart could render neither
         honestly. */
      const rule = str(v["rule"]);
      if (to === null || rule === null) return null;
      return { kind, to, rule, why };
    }
    default:
      return null;
  }
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
  if (id === null) return null;
  const progress = parseProgress(v["progress"]);
  if (progress === null) return null;
  return {
    id,
    progress,
    name: str(v["name"]),
    dir: str(v["dir"]) ?? "",
    /* Neither word is guessed for a server that sent nothing: the two describe
       different promises about the tree the agent started in, and defaulting to
       `repo` would be inventing the safe one. See `LaunchResolution`. */
    resolution: v["resolution"] === "repo" ? "repo" : v["resolution"] === "dir" ? "dir" : null,
    startedDir: str(v["startedDir"]),
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
