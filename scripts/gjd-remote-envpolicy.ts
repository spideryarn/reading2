/**
 * **`push-env` for a repo that has no typed allowlist** — which is every repo
 * except this one.
 *
 * Spideryarn's `.env.local` is governed by the hand-written `ALLOWLIST` in
 * [gjd-remote-env.ts](gjd-remote-env.ts), and that stays. hellozenno has no such
 * list and is not going to get one, so this file is the other half: read the
 * repo's `.env.local`, take the **key names only**, ask a model to sort
 * them, show the reader a checklist, and remember what they ticked.
 *
 * > an LLM should look at .env.local environment variable names (but NOT
 * > values, try to never read them into your context) and make a proposal which
 * > the user can override … also with the option to allow all/none
 * >
 * > — Greg, 2026-09-02
 *
 * Pure functions and plain filesystem reads, like its two neighbours: no ssh, no
 * prompting, no process spawning, so the rules that matter are testable without
 * a server or a terminal (tests/gjd-remote-envpolicy.test.ts). The CLI in
 * scripts/gjd-remote.ts does the asking and the sending.
 *
 * ## A value must not reach anything
 *
 * The one property this file is for. **No function here takes a value as an
 * argument** — `extractEnvKeyNames` is handed the file's text and returns names,
 * and everything downstream of it is typed against `string[]` of names. The
 * value guard is a *callback the CLI supplies*, so the comparison happens in the
 * caller and only its verdict (`"ok"` / `"not-local"`) crosses back.
 *
 * The sinks that were checked, in one test rather than eight (GPT Sol's
 * review, finding 6): the returned names, the parse problems, the serialised
 * request body, the checklist rows, the saved policy file, and the message of
 * every error any of them can throw. Malformed input on both ends is exercised
 * too, because a new parser propagating its own exception is the plausible leak
 * and `JSON.parse` puts a prefix of its input into the `SyntaxError`.
 *
 * `scanEnv` from [gjd-remote-env.ts](gjd-remote-env.ts) is reused rather than
 * re-written, for the reason that file already gives about having one parser:
 * two of them is how a diff quietly lies. It also already reports a malformed
 * line by NUMBER only, because whatever is on it may well be the secret.
 *
 * ## The paid call, and what the CLI must wrap it in
 *
 * `proposeEnvKeys` reaches OpenRouter through `openRouterJson`, the gateway
 * seam, as `AI_JOB_ROUTE`'s `env-proposal` job on `PROPOSAL_MODEL`.
 * **This module deliberately opens no ledger.** The caller must:
 *
 * ```ts
 * loadEnvLocal();                       // src/env.ts — THIS repo's key, not the target repo's
 * await withLedger("cli", async () => { // src/cli-ledger.ts:86
 *   const result = await proposeEnvKeys(names, { call: defaultProposalCall });
 * });
 * ```
 *
 * Without that wrapper the call still happens and still costs money: the meter
 * finds no collector open, warns once, and drops the row — `recordSpend` in
 * src/ai-spend.ts. That is Sol's finding 7, and it is exactly how `npm run
 * labels` and `npm run pdf` spent for weeks into a total that looked complete.
 * The key comes from `loadEnvLocal()`, which reads **this** repo's `.env.local`
 * off the module's own location regardless of the cwd, so running `gjd-remote`
 * from hellozenno still finds it.
 *
 * ## Pre-ticking is a parameter, because it is undecided
 *
 * Greg asked for "the model proposes, the user overrides"; Sol argued no key
 * should ever start ticked on a model's say-so. Rather than guess,
 * `planChecklist` takes `preTick` and both answers are one flag —
 * docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md,
 * "Open questions for Greg".
 */
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parse as parseToml, TomlError } from "smol-toml";
import { openRouterJson } from "../src/ai-call.js";
import type { AiRequestBody, ChatJob, JsonCall } from "../src/ai-call.js";
import { CAPABLE_MODEL_OPENROUTER } from "../src/models.js";
import { scanEnv } from "./gjd-remote-env.js";
import { isRepoValue, REPO_UNKNOWN } from "./gjd-remote-repo.js";

/** Anything this file refuses to do, in the CLI's voice: first line lower-case,
 *  later lines indented, and it names something the reader can act on. Never
 *  carries a value — see the header. */
export class EnvPolicyError extends Error {
  override readonly name = "EnvPolicyError";
}

// ------------------------------------------------------------- part 1: names

/** What a `.env.local` declares, by name, and what reading it had to overlook. */
export type EnvKeyNames = {
  /** In file order, de-duplicated. Never a value. */
  names: string[];
  /** `scanEnv`'s report, unchanged: line numbers and key names, never content. */
  problems: string[];
};

/**
 * **The key names in a `.env.local`, and nothing else.**
 *
 * The whole of the "names only" guarantee starts here: this is the only
 * function in the file that is ever handed the file's bytes, and the only thing
 * it returns from them is `Map.keys()`.
 *
 * De-duplicated because `scanEnv` already collapses a repeated key into one map
 * entry and reports the duplicate as a problem; the checklist must show one row
 * per name or the reader is ticking the same key twice.
 */
export function extractEnvKeyNames(text: string): EnvKeyNames {
  const { values, problems } = scanEnv(text);
  return { names: [...values.keys()], problems };
}

// -------------------------------------------------------- part 2: the model

/**
 * What the model is asked to decide about each name.
 *
 * Five arms rather than a boolean, because "I do not recognise this" and "this
 * is fine" must not be the same answer — `unknown` is what an unfamiliar key
 * gets, and it is never pre-ticked. The two dangerous arms are separate for the
 * same reason: `infrastructure-destroying` is the class the two hard-guarded
 * names belong to, and seeing the model put a *third* name in it is worth
 * knowing about even though the guard list is closed.
 */
export const KEY_CLASSES = [
  "local-dev-only",
  "shared-provider-key",
  "production-or-signing-secret",
  "infrastructure-destroying",
  "unknown",
] as const;

export type KeyClass = (typeof KEY_CLASSES)[number];

/** The two arms that may start ticked when `preTick` is `"proposal"`. Read by
 *  `planChecklist`; a class not named here starts unticked, so adding a sixth
 *  arm to `KEY_CLASSES` defaults to caution rather than to permission. */
const SAFE_CLASSES: readonly KeyClass[] = ["local-dev-only", "shared-provider-key"];

/** One row of the model's answer, after validation. */
export type ProposedKey = { class: KeyClass; reason: string };

/** A proposal, or the reason there is none. Never partial: half a proposal
 *  would pre-tick some rows on evidence and leave others blank on none, and
 *  nothing on screen would say which was which. */
export type Proposal =
  | { ok: true; proposal: Map<string, ProposedKey> }
  | { ok: false; why: string };

/** The job name, once, so the routing table and the caller cannot drift. */
export const PROPOSAL_JOB: ChatJob = "env-proposal";

/**
 * **The capable model, and the reason is coverage rather than safety.**
 *
 * This started on `QUICK_MODEL_OPENROUTER` — a cheap classification, run once
 * per repo. The Stage 4 spike measured both on the two real files
 * (docs/research/260902b-env-key-proposal-spike.md) and moved it:
 *
 * - **Safety was never the difference.** Across six runs on both models there
 *   was not one false positive — no key that ground truth calls a production or
 *   infrastructure secret ever landed in a pre-tickable class. That is what
 *   pre-ticking from the proposal needs in order to be safe, and both models
 *   have it.
 * - **Coverage was.** The quick model left a quarter of each file `unknown`,
 *   which is barely a proposal — the reader decides eleven rows on hellozenno
 *   rather than four. Worse, it twice failed to name a token that can delete
 *   the box; the capable one named all four such keys on Spideryarn, including
 *   two GitHub PATs no ground-truth document mentions, off `PAT` in the name.
 * - **The cost is two cents**, against a tenth of one. Eighteen times more, for
 *   a command run once per repo and a handful of times a year. That is a saving
 *   nobody asked for.
 *
 * The unknowns that remain are not noise to tune away. They cluster on
 * connection-string components — `DATABASE_URL`, `SUPABASE_URL` — where the
 * honest answer from a name alone is "this could be production", and only the
 * value settles it. That is why `MUST_BE_LOCAL` and the `sk_live_` prefix check
 * in gjd-remote-env.ts still exist, and why the proposal does not replace them.
 *
 * **Its stability is unmeasured** — the spike had budget for one capable run
 * per repo. Expect a class to change between runs, and do not read that as a
 * signal about the key.
 */
export const PROPOSAL_MODEL = CAPABLE_MODEL_OPENROUTER;

/** How long a reason may be once it reaches a terminal row. Long enough for a
 *  sentence, short enough that it cannot be a payload. */
export const MAX_REASON_CHARS = 120;

/** How many names may be sent in one request. A `.env.local` with more than
 *  this is not a config file, and a prompt built from it is not a cheap call. */
export const MAX_NAMES = 200;

const SYSTEM_PROMPT = [
  "You are helping decide which environment variable names from a developer's",
  ".env.local are safe to copy onto a shared remote development box. That box",
  "runs many autonomous agents as one Unix user with passwordless sudo, so",
  '"on the box" means "readable by all of them".',
  "",
  "You are given KEY NAMES ONLY, one per line. You will never be given a value,",
  "and you must not ask for one or guess at one.",
  "",
  "Classify every name you are given as exactly one of:",
  "  local-dev-only              a local stack, a fixture, a demo credential, a",
  "                              port, a feature flag — harmless if it leaked",
  "  shared-provider-key         a paid API key for a model or service provider;",
  "                              real money, but no production data behind it",
  "  production-or-signing-secret  a production database credential, a session or",
  "                              JWT signing secret, a live payment key",
  "  infrastructure-destroying   a token that can delete servers, projects or",
  "                              accounts",
  "  unknown                     you cannot tell from the name alone",
  "",
  "Prefer unknown to a guess. Give one short reason per name, at most 20 words,",
  "plain text, no newlines.",
  "",
  'Answer with strict JSON and nothing else: {"keys":[{"name":"...",',
  '"class":"...","reason":"..."}]}. Include every name you were given, exactly',
  "once, spelled exactly as given. Add no others.",
].join("\n");

/**
 * The request body, built from names and a constant.
 *
 * There is no parameter here that a value could arrive through — the signature
 * is `readonly string[]`, and the only other input is the constant above. That
 * is deliberate and it is the cheapest half of the leak proof: the test asserts
 * the serialised body, but the type already refuses.
 *
 * `response_format` because the reply is parsed, and the routing table's
 * `require_parameters` is what stops an upstream dropping it silently
 * (src/ai-call.ts).
 *
 * ## There is no `temperature`, and that is the whole of a bug worth keeping
 *
 * The first version sent `temperature: 0`, reasoning that a classifier which
 * answers differently on a re-run makes the saved policy look like it drifted.
 * **Every call it made was a 404.** `require_parameters: true` means "only
 * upstreams that support the parameters actually sent", and no upstream serving
 * this model accepts a temperature, so OpenRouter filtered every endpoint away
 * and answered `No endpoints found that can handle the requested parameters`
 * with `failed_routing_step: "Filter by Parameters"`. Found by the Stage 4
 * spike, docs/research/260902b-env-key-proposal-spike.md.
 *
 * Two things make it worth a paragraph rather than a deletion. It **failed
 * silently**: `proposeEnvKeys` turns a `ProviderRefused` into "the model could
 * not be reached", so the reader saw a blank checklist that looks exactly like
 * a provider having a bad afternoon, and each attempt still cost a ledger row.
 * And the determinism it was paying for **was never bought** — the same spike
 * measured two runs on identical names and 5 of 18 rows changed class, because
 * every other job in the app sends a temperature to an upstream that quietly
 * drops it, which is why nothing else here has ever tripped on this.
 *
 * So: `require_parameters` turns an unsupported parameter from a silent no-op
 * into a hard 404. Nothing may be added to this body without checking that the
 * chosen model's upstreams accept it. `tests/gjd-remote-envpolicy.test.ts` pins
 * the key set for exactly that reason.
 */
export function buildProposalRequest(names: readonly string[]): AiRequestBody {
  if (names.length === 0) {
    throw new EnvPolicyError("there are no environment variable names to classify");
  }
  if (names.length > MAX_NAMES) {
    throw new EnvPolicyError(
      `refusing to classify ${names.length} environment variable names — the limit is ${MAX_NAMES}.\n` +
        `  A .env.local this large is probably not the file you meant to push.`,
    );
  }
  return {
    model: PROPOSAL_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: names.join("\n") },
    ],
    response_format: { type: "json_object" },
  };
}

/**
 * The model's own words, out of the envelope `openRouterJson` returns.
 *
 * **The `JSON.parse` failure is swallowed rather than rethrown**, for the reason
 * `openRouterJson` gives about its own: V8 puts the first characters of the
 * offending input into the `SyntaxError` message. Here that input is the
 * model's reply, which should contain only names — but "should" is not a
 * guarantee this function can make about a string a provider wrote, and this is
 * the one place in the file where a foreign string could become an error
 * message.
 */
export function readProposalContent(
  json: unknown,
): { ok: true; value: unknown } | { ok: false; why: string } {
  if (typeof json !== "object" || json === null) {
    return { ok: false, why: "the provider sent something that is not a JSON object" };
  }
  const choices = (json as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return { ok: false, why: "the provider's reply had no choices in it" };
  }
  const first: unknown = choices[0];
  const message =
    typeof first === "object" && first !== null ? (first as { message?: unknown }).message : undefined;
  const content =
    typeof message === "object" && message !== null
      ? (message as { content?: unknown }).content
      : undefined;
  if (typeof content !== "string") {
    return { ok: false, why: "the provider's reply carried no message content" };
  }
  try {
    return { ok: true, value: JSON.parse(content) as unknown };
  } catch {
    return { ok: false, why: "the model's answer was not the JSON it was asked for" };
  }
}

/**
 * **Validate the model's answer against the names we sent, and fail closed.**
 *
 * Sol's plan finding 5: the output is checked as an exact subset of the input.
 * An unknown name, a duplicate, a class outside the five, or a missing `keys`
 * array makes the whole thing `ok: false` — never a partial proposal — and the
 * CLI then pre-ticks nothing. A model that invents a name is a model whose
 * classifications should not be trusted for the names it did not invent.
 *
 * "Exact subset", not "equal": a model that omits a name is not an error, it is
 * a name with no proposal, which `planChecklist` shows as such. Inventing is
 * the failure; forgetting is a gap, and a gap is visible.
 *
 * **That includes `{"keys": []}` for a file full of names**, which GPT Sol's
 * Stage 3 finding 8 asked about: it is accepted, and it means every row arrives
 * with "no proposal for this key" and **unticked**. Taken deliberately over the
 * stricter reading (one decision per name, or no proposal at all), because the
 * two answers fail in opposite directions and only one of them is safe. Omission
 * costs the reader a starting state they have to fill in themselves — visible on
 * every row, and the checklist still works. Requiring completeness would mean a
 * model that skipped one name of forty threw the other thirty-nine away, and the
 * pressure would then be to accept partial answers. Under `preTick: "proposal"`
 * nothing unproposed is ever ticked, so a gap can only ever send FEWER keys than
 * the reader intended, never more.
 *
 * `reason` is stripped of control characters and truncated before it goes
 * anywhere near a terminal row — a reason is printed inside a checkbox list,
 * and an escape sequence there rewrites the screen the reader is deciding on.
 */
export function parseProposal(json: unknown, names: readonly string[]): Proposal {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { ok: false, why: "the model's answer was not a JSON object" };
  }
  const keys = (json as { keys?: unknown }).keys;
  if (!Array.isArray(keys)) {
    return { ok: false, why: "the model's answer had no `keys` array in it" };
  }
  const allowed = new Set(names);
  const proposal = new Map<string, ProposedKey>();
  for (const entry of keys as unknown[]) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { ok: false, why: "one of the model's entries was not an object" };
    }
    const row = entry as { name?: unknown; class?: unknown; reason?: unknown };
    if (typeof row.name !== "string") {
      return { ok: false, why: "one of the model's entries had no name" };
    }
    const name = row.name;
    if (!allowed.has(name)) {
      /* Naming it is safe — it came back from a model that was only ever sent
         names — and it is the one thing that makes this failure diagnosable. */
      return { ok: false, why: `the model answered about '${name}', which it was not asked about` };
    }
    if (proposal.has(name)) {
      return { ok: false, why: `the model answered about '${name}' twice` };
    }
    if (typeof row.class !== "string" || !isKeyClass(row.class)) {
      return { ok: false, why: `the model gave '${name}' a class that is not one of the five` };
    }
    if (typeof row.reason !== "string") {
      return { ok: false, why: `the model gave '${name}' no reason` };
    }
    proposal.set(name, { class: row.class, reason: tidyReason(row.reason) });
  }
  return { ok: true, proposal };
}

function isKeyClass(value: string): value is KeyClass {
  return (KEY_CLASSES as readonly string[]).includes(value);
}

/**
 * One line, printable, bounded.
 *
 * Control characters go first — including the ones inside an ANSI escape, which
 * begins with U+001B — then whitespace is collapsed, then the length is cut.
 * In that order: truncating first can leave half an escape sequence, which is
 * still an escape sequence to a terminal.
 */
function tidyReason(reason: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
  const flat = reason.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  return flat.length <= MAX_REASON_CHARS ? flat : `${flat.slice(0, MAX_REASON_CHARS - 1)}…`;
}

/** The one thing this module needs from the network, injected so a test never
 *  needs one. The real implementation is `defaultProposalCall`. */
export type ProposalCall = (body: AiRequestBody) => Promise<JsonCall>;

/**
 * `openRouterJson`, bound to this job.
 *
 * A factory rather than a bare arrow so that a test can prove the *job name*
 * reaches the gateway — which is the thing that decides the route, the wire and
 * what the spend row is called, and which is untestable through the real import
 * without making a real call. `defaultProposalCall` below is this over the real
 * seam and is the only thing the CLI should pass.
 */
export function makeProposalCall(
  json: (job: ChatJob, body: AiRequestBody) => Promise<JsonCall>,
): ProposalCall {
  return (body) => json(PROPOSAL_JOB, body);
}

/** The real call. Nothing else: no ledger, no retry, no logging — see the
 *  header for what the CLI has to wrap it in. */
export const defaultProposalCall: ProposalCall = makeProposalCall(openRouterJson);

/**
 * **Ask the model, and come back with a proposal or a reason there is none.**
 *
 * A provider failure is a `{ ok: false }`, not a throw: this call is advisory,
 * and `push-env` refusing to run because a classifier was unavailable would be
 * a nicety taking the feature down with it. The reader still gets the checklist;
 * it just starts blank. The error's own message is never included — it is a
 * provider's words, and this file does not repeat those.
 */
export async function proposeEnvKeys(
  names: readonly string[],
  deps: { call: ProposalCall },
): Promise<Proposal> {
  let reply: JsonCall;
  try {
    reply = await deps.call(buildProposalRequest(names));
  } catch (err) {
    if (err instanceof EnvPolicyError) throw err;
    return { ok: false, why: "the model could not be reached" };
  }
  const content = readProposalContent(reply.json);
  if (!content.ok) return content;
  return parseProposal(content.value, names);
}

// ---------------------------------------------------- part 3: the checklist

/** One row the reader sees. `disabled` is the hard guard; `checked` is the
 *  suggestion; `new` is "this repo has never sent this key before". */
export type ChecklistItem = {
  name: string;
  checked: boolean;
  disabled: boolean;
  /** Why it is disabled, or what the model made of it. One line, printable. */
  description: string;
  new: boolean;
};

/**
 * Everything the checklist is built from, and **not one value among them**.
 *
 * `valueGuard` is the seam that keeps it that way: the CLI holds the parsed
 * `.env.local`, runs `isLocalDatabaseUrl` (src/db/ssl.ts) over the value itself,
 * and passes back a verdict. This module never sees the string it judged.
 */
/**
 * **The two hard guards themselves**, as data, so the same pair can be handed to
 * the function that draws the rows and to the function that checks the answer.
 *
 * Split out for GPT Sol's Stage 3 finding 5. `applyGuards` used to re-read
 * `item.disabled`, which is not a re-application of anything: it is the first
 * application's *output*, and a bug that produced a wrong `disabled` would be
 * faithfully honoured by the check meant to catch it. Now both callers run the
 * predicates, and only agreement between two independent runs lets a name
 * through.
 */
export type Guards = {
  /** Names that may never be sent, whatever anyone ticks. `FORBIDDEN_NAMES`. */
  forbiddenNames: ReadonlySet<string>;
  /** The value guard's verdict for one name. See `ChecklistInput`. */
  valueGuard: (name: string) => "ok" | "not-local";
};

export type ChecklistInput = Guards & {
  names: readonly string[];
  /** The model's answer, when there was one. Absent ⇒ nothing is pre-ticked
   *  under `"proposal"`, which is the malformed-reply path. */
  proposal: Map<string, ProposedKey> | undefined;
  /** What this repo's saved policy already approves. Absent ⇒ every key is new. */
  approved: Set<string> | undefined;
  /** Which answer to Greg's open question we are running under. */
  preTick: "proposal" | "approved-only";
};

const FORBIDDEN_WHY =
  "never sent: this key can destroy the box or the production project";
const NOT_LOCAL_WHY =
  "never sent: its value does not point at a loopback address, so it may be production";

/**
 * **The rows, in file order.**
 *
 * The order of the checks is the behaviour: a disabled row is never checked,
 * whatever the proposal said and whatever the saved policy says, because
 * `disabled` is computed first and `checked` is `false` under it. Sol asked for
 * the guards to be visible *and* re-applied; `applyGuards` is the second half,
 * and it does not trust this one.
 */
export function planChecklist(input: ChecklistInput): ChecklistItem[] {
  const approved = input.approved ?? new Set<string>();
  return input.names.map((name) => {
    const isNew = !approved.has(name);
    if (input.forbiddenNames.has(name)) {
      return { name, checked: false, disabled: true, description: FORBIDDEN_WHY, new: isNew };
    }
    if (input.valueGuard(name) === "not-local") {
      return { name, checked: false, disabled: true, description: NOT_LOCAL_WHY, new: isNew };
    }
    const proposed = input.proposal?.get(name);
    const checked =
      input.preTick === "approved-only"
        ? approved.has(name)
        : proposed !== undefined && SAFE_CLASSES.includes(proposed.class);
    return { name, checked, disabled: false, description: describe(proposed, isNew), new: isNew };
  });
}

function describe(proposed: ProposedKey | undefined, isNew: boolean): string {
  const seen = isNew ? "not sent before" : "sent before";
  if (proposed === undefined) return `${seen} · no proposal for this key`;
  return `${seen} · ${proposed.class}: ${proposed.reason}`;
}

/** What survived the guards, and what did not. Refusals are by name, with the
 *  reason the reader was already shown. */
export type GuardOutcome = {
  send: string[];
  refused: { name: string; why: string }[];
};

/**
 * **Re-apply the guards after the reader has chosen** — Sol's review, and the
 * reason it is a separate function rather than a comment.
 *
 * A checkbox library's `disabled` is presentation. The prompt wrapper does pass
 * one through now (scripts/gjd-remote-prompt.ts), and the library honours it —
 * but `--all` never goes through the library at all, and a row's `disabled` is
 * the *output* of `planChecklist`, not an independent fact. So this **runs the
 * predicates itself** rather than reading `item.disabled`: two independent runs
 * of the same rule, and a name is sent only if both let it through. That is GPT
 * Sol's Stage 3 finding 5, and it is why `guards` is a parameter — the version
 * that trusted `item.disabled` was checking its own homework.
 *
 * **A duplicated name is an error, not a resolution.** Two rows called
 * `DATABASE_URL`, one disabled and one not, used to put the name in `refused`
 * AND in `send` — the caller then printed a refusal and sent the key. There is
 * no right answer to pick between them: a checklist with two rows for one key is
 * a bug in whatever built it, and the safe reading of a bug is to stop.
 *
 * A name selected that is not on the checklist at all is refused, which is where
 * a stale `--all` list or a hand-typed name lands.
 *
 * Returns `send` in checklist order, not in the order the reader clicked, so the
 * confirmation line and the written file are stable between runs.
 */
export function applyGuards(
  selected: readonly string[],
  items: readonly ChecklistItem[],
  guards: Guards,
): GuardOutcome {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.name)) {
      throw new EnvPolicyError(
        `the checklist has two rows for '${item.name}', so there is no single answer to ` +
          `"is it allowed?" — nothing has been sent.`,
      );
    }
    seen.add(item.name);
  }

  const wanted = new Set(selected);
  const send: string[] = [];
  const refused: { name: string; why: string }[] = [];
  for (const name of wanted) {
    if (!seen.has(name)) refused.push({ name, why: "not on the checklist for this repo" });
  }
  for (const item of items) {
    if (!wanted.has(item.name)) continue;
    const why = blockedBecause(item.name, guards);
    if (why === undefined) send.push(item.name);
    else refused.push({ name: item.name, why });
  }
  refused.sort((a, b) => a.name.localeCompare(b.name));
  return { send, refused };
}

/** The guards, run for real. `undefined` means "nothing forbids this name",
 *  which is the only thing that gets a key onto the box. */
function blockedBecause(name: string, guards: Guards): string | undefined {
  if (guards.forbiddenNames.has(name)) return FORBIDDEN_WHY;
  if (guards.valueGuard(name) === "not-local") return NOT_LOCAL_WHY;
  return undefined;
}

/** Every row a "select all" may tick — the eligible ones, and no others. The
 *  CLI uses this rather than mapping over `items` itself, so "select all" and
 *  the guard cannot come to different conclusions. */
export function selectableNames(items: readonly ChecklistItem[]): string[] {
  return items.filter((i) => !i.disabled).map((i) => i.name);
}

// -------------------------------------------------- part 4: the saved policy

/** `~/.config/gjd-remote`, or `$XDG_CONFIG_HOME/gjd-remote`. The one
 *  laptop-side directory this tool owns. */
export const CONFIG_SUBDIR = "gjd-remote";
/** Where a repo's policy lives under it. */
export const POLICY_SUBDIR = path.join(CONFIG_SUBDIR, "repos");

/** The default config home, read at call time so a test can move `HOME` and
 *  `XDG_CONFIG_HOME` without this file having memoised either. */
export function defaultConfigHome(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg !== undefined && xdg !== "" ? xdg : path.join(homedir(), ".config");
}

/**
 * The policy file for one repo: `<configHome>/gjd-remote/repos/<owner>--<name>.toml`.
 *
 * The slug is validated rather than trusted, with the same validator the tmux
 * metadata and the durable log use, because a slug with a `/` or a `..` in it
 * becomes a path here — `gjd-remote-repo.ts` records that the identity producer
 * can poison its own consumers. `unknown` is refused outright: a session started
 * against an arbitrary `--dir` belongs to no repo, and a policy file for "no
 * repo" would be shared by every one of them.
 *
 * The `--` join is ambiguous in principle (`a/b--c` and `a--b/c` land on one
 * name) and cannot happen in practice, because a GitHub owner may not contain
 * two consecutive hyphens. Rather than rely on that, the file records the slug
 * it belongs to and `readPolicy` refuses a mismatch.
 */
export function policyPath(slug: string, configHome: string = defaultConfigHome()): string {
  if (slug === REPO_UNKNOWN || !isRepoValue(slug) || !slug.includes("/")) {
    throw new EnvPolicyError(
      `'${slug}' is not a repo this can keep a policy for — it needs an owner/name slug.`,
    );
  }
  const [owner, name] = slug.split("/");
  return path.join(configHome, POLICY_SUBDIR, `${owner}--${name}.toml`);
}

/** A repo's saved answer, or why there is none. */
export type PolicyRead =
  | { kind: "policy"; repo: string; approved: string[]; savedAt: string }
  | { kind: "absent" }
  | { kind: "error"; why: string };

/** What gets written. `repo` is in the file so the filename is not the only
 *  thing saying which repo this is. */
export type Policy = { repo: string; approved: readonly string[] };

const POLICY_KEYS = ["repo", "approved", "saved_at"] as const;

/** A `.env` key name, as the parser above would have produced. Anything else in
 *  an `approved` list is a hand-edit that would silently never match. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * **Read a repo's saved policy, strictly.**
 *
 * An unreadable or wrong-shaped file is `error`, never an empty approval set:
 * the two are indistinguishable to a caller that treats a failure as "nothing
 * approved yet", and the second run would then present every key as new and
 * quietly overwrite the file that could not be read.
 *
 * Unknown keys are an error by name, the same rule
 * scripts/gjd-remote-config.ts applies to `.gjd-remote/config.toml` and for the
 * same reason: a misspelt key that does nothing is silent success.
 *
 * @param expectRepo the slug this file is supposed to be about. A mismatch is
 *   an error rather than a warning — it means the filename collided or the file
 *   was copied, and approving hellozenno's keys for Spideryarn is exactly the
 *   accident this parameter exists to make impossible.
 */
export function readPolicy(file: string, expectRepo: string): PolicyRead {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if (errnoCode(err) === "ENOENT") return { kind: "absent" };
    return { kind: "error", why: `${file} could not be read: ${errnoCode(err) ?? "unknown error"}` };
  }
  let parsed: unknown;
  try {
    parsed = parseToml(text);
  } catch (err) {
    const where = err instanceof TomlError ? ` at line ${err.line}` : "";
    return { kind: "error", why: `${file} is not valid TOML${where}` };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "error", why: `${file} is not a table of keys` };
  }
  const table = parsed as Record<string, unknown>;
  for (const key of Object.keys(table)) {
    if (!(POLICY_KEYS as readonly string[]).includes(key)) {
      return { kind: "error", why: `${file} has an unknown key '${key}'` };
    }
  }
  const repo = table.repo;
  if (typeof repo !== "string" || !isRepoValue(repo) || repo === REPO_UNKNOWN) {
    return { kind: "error", why: `${file} does not say which repo it is for` };
  }
  if (repo !== expectRepo) {
    return { kind: "error", why: `${file} is the policy for ${repo}, not for ${expectRepo}` };
  }
  const list = readApprovedList(file, table.approved);
  if (typeof list === "string") return { kind: "error", why: list };
  const approved = list;
  const savedAtRaw = table.saved_at;
  const savedAt =
    savedAtRaw instanceof Date
      ? savedAtRaw.toISOString()
      : typeof savedAtRaw === "string"
        ? savedAtRaw
        : undefined;
  if (savedAt === undefined) {
    return { kind: "error", why: `${file} has no 'saved_at' timestamp` };
  }
  return { kind: "policy", repo, approved, savedAt };
}

/**
 * The `approved` array, validated — or the sentence saying why it is not one.
 *
 * A `string` return means failure, which is the one shape that cannot be
 * confused with a list of names. Split out of `readPolicy` because that
 * function was one branch over the complexity limit, and this is the half of it
 * with its own rule: **an entry that is not a variable name is an error, not a
 * skip.** Skipping would silently un-approve a key somebody had hand-edited,
 * and the next run would present it as new.
 */
function readApprovedList(file: string, raw: unknown): string[] | string {
  if (!Array.isArray(raw)) return `${file} has no 'approved' list`;
  const approved: string[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry !== "string" || !ENV_NAME.test(entry)) {
      return `${file} has an 'approved' entry that is not a variable name`;
    }
    if (approved.includes(entry)) return `${file} approves '${entry}' twice`;
    approved.push(entry);
  }
  return approved;
}

/** The bytes for a policy. Separate from the writing so the round trip can be
 *  checked without a filesystem, and so the readback below compares text this
 *  function produced rather than text the disk happened to hold. */
export function serialisePolicy(policy: Policy, now: Date): string {
  for (const name of policy.approved) {
    if (!ENV_NAME.test(name)) {
      throw new EnvPolicyError(`'${name}' is not a variable name and will not be written down`);
    }
  }
  const sorted = [...new Set(policy.approved)].sort();
  return [
    `# Which .env.local keys you approved for ${policy.repo}, and nothing else.`,
    "# Written by `gjd-remote push-env`. Key NAMES only — no value has ever been",
    "# read into this file, or into the model call that proposed them.",
    "",
    `repo = ${JSON.stringify(policy.repo)}`,
    `saved_at = ${now.toISOString()}`,
    sorted.length === 0
      ? "approved = []"
      : `approved = [\n${sorted.map((n) => `  ${JSON.stringify(n)},`).join("\n")}\n]`,
    "",
  ].join("\n");
}

/** How the bytes reach the disk. Injectable only so the readback check can be
 *  watched failing — see the test. The default is the whole recipe. */
export type PolicyWriter = (tempFile: string, text: string) => void;

const realWriter: PolicyWriter = (tempFile, text) => {
  /* `wx`: create, and fail if anything is already there. Not `w`, which would
     happily follow a symlink a co-tenant had planted at the temp name. The mode
     is the third argument rather than a later chmod so the file is never, for
     any instant, readable by anyone else. */
  const fd = openSync(tempFile, "wx", 0o600);
  try {
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
};

/**
 * **Write a repo's policy, and prove it landed.**
 *
 * The recipe, in the order Sol's finding 5 asks for and for the reasons each
 * step has:
 *
 * - the directory is created `0700` **and chmodded**, because `mkdir`'s mode is
 *   masked by the umask and an already-existing directory ignores it entirely;
 * - a symlink at the destination is refused, by `lstat` rather than `stat`,
 *   because a `stat` on a symlink describes its target and the check would pass
 *   while writing somewhere else;
 * - the temp file is a fresh name opened `wx` at `0600` — the mode is the third
 *   argument rather than a `chmod` afterwards, so the file is never readable by
 *   anyone else for even an instant, and `umask` can only take bits away;
 * - `rename`, which is atomic, so a reader never sees half a file, and which
 *   replaces the destination *inode* — that is what makes an existing `0644`
 *   file come out `0600` rather than keeping its old permissions;
 * - and it is **read back and compared** before this returns, bytes and mode,
 *   because every step above reports success by not throwing, and "did not
 *   throw" has been wrong here before (docs/reusable/silent-success.md).
 *
 * **There is deliberately no `chmod 0600` on the destination**, which is what
 * Sol's review asked for in so many words. It would sit one line above the mode
 * check and make it vacuous: the assertion would then be verifying the `chmod`
 * we had just performed rather than the permissions the write actually
 * produced. Both were tried. With the `chmod` in place, opening the temp file
 * `0644` instead of `0600` changed nothing and every test still passed; with it
 * gone, that mutation turns three tests red. A guarantee is worth having only
 * where something can notice its absence.
 *
 * The temp file is removed on every failing path, so a crashed write does not
 * leave a second copy of the approvals sitting beside the first.
 */
export function writePolicy(
  file: string,
  policy: Policy,
  now: Date,
  deps: { write?: PolicyWriter } = {},
): void {
  const text = serialisePolicy(policy, now);
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);

  const existing = lstatOrUndefined(file);
  if (existing?.isSymbolicLink() === true) {
    throw new EnvPolicyError(
      `refusing to write ${file} — it is a symbolic link.\n` +
        `  This file records what may leave your laptop; delete the link and run this again.`,
    );
  }

  const tempFile = `${file}.tmp-${randomBytes(6).toString("hex")}`;
  try {
    (deps.write ?? realWriter)(tempFile, text);
    const temp = lstatOrUndefined(tempFile);
    if (temp === undefined || temp.isSymbolicLink() || !temp.isFile()) {
      throw new EnvPolicyError(`refusing to install ${tempFile} — it is not a regular file`);
    }
    renameSync(tempFile, file);
  } finally {
    rmSync(tempFile, { force: true });
  }

  const back = readFileSync(file, "utf8");
  if (digest(back) !== digest(text)) {
    throw new EnvPolicyError(
      `${file} does not contain what was just written to it — nothing has been approved.`,
    );
  }
  const mode = statSync(file).mode & 0o777;
  if (mode !== 0o600) {
    throw new EnvPolicyError(
      `${file} was left mode ${mode.toString(8)} rather than 600 — nothing has been approved.`,
    );
  }
}

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function lstatOrUndefined(file: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(file);
  } catch {
    return undefined;
  }
}

function errnoCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("code" in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
