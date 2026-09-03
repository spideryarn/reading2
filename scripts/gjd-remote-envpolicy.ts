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
 * a server or a terminal (tests/gjd-remote-envpolicy.test.ts). `pushEnvPlan` at
 * the bottom is the order those rules run in, and it reaches the model, the
 * prompts and the terminal only through callbacks its caller supplies. The CLI
 * in scripts/gjd-remote.ts supplies them, and does the sending.
 *
 * ## A value must not reach anything
 *
 * The one property this file is for. **Three functions take the file's bytes**
 * — `extractEnvKeyNames`, `envGuards` and `pushEnvPlan`, which is built from the
 * other two — and everything else here is typed against `string[]` of names.
 * Those three are the whole of the trusted surface, and what each does with the
 * bytes is one thing: names out of them, a verdict out of them, and the payload
 * for the box out of them. `EnvPlan.payload` is the only value-bearing thing any
 * of this returns.
 *
 * It used to be one function and a `valueGuard` callback the CLI supplied, so
 * that no value crossed the seam at all. That was a nicer sentence and a worse
 * test: the leak test could only reach the sinks on this side of the seam, and
 * the CLI — which held the bytes, the prompts and the printing — had none. GPT
 * Sol's Stage 4 finding 2. `pushEnvPlan` moved the decisions here so that ONE
 * test can feed a sentinel value in at the top and check every sink it could
 * come out of.
 *
 * The sinks that were checked, in one test rather than eight (GPT Sol's
 * review, finding 6): the returned names, the parse problems, the serialised
 * request body, the checklist rows, the saved policy file, and the message of
 * every error any of them can throw. Malformed input on both ends is exercised
 * too, because a new parser propagating its own exception is the plausible leak
 * and `JSON.parse` puts a prefix of its input into the `SyntaxError`. The
 * `pushEnvPlan` test adds the four that only exist once the decisions are here:
 * the names handed to the paid call, everything `say` prints, the rows the
 * checklist prompt is given, and the ledger row.
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
import { buildEnvPayload, FORBIDDEN_NAMES, localityVerdict, scanEnv } from "./gjd-remote-env.js";
import type { EnvPayload } from "./gjd-remote-env.js";
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
  /** Every name the reader has already decided on, ticked or not — a superset of
   *  `approved`. A name in here takes its state from the saved decision and the
   *  model gets no say; a name outside it is undecided, and only then does the
   *  proposal pre-tick anything. Absent ⇒ falls back to `approved`, which is what
   *  a policy file written before `reviewed` existed reads as. */
  reviewed: Set<string> | undefined;
  /** When that policy was saved, ISO. Printed on a row the reader unticked, so
   *  "you decided this" says when. Absent ⇒ the row says "before". */
  savedAt: string | undefined;
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
 * The order of the checks is the behaviour, and it is three tiers deep:
 *
 * 1. **A disabled row is never checked**, whatever the proposal said and
 *    whatever the saved policy says, because `disabled` is computed first and
 *    `checked` is `false` under it. Sol asked for the guards to be visible *and*
 *    re-applied; `applyGuards` is the second half, and it does not trust this one.
 * 2. **A row the reader has already decided takes the saved answer**, ticked or
 *    unticked, and the model gets no say in it. That is GPT Sol's Stage 4
 *    finding 1: the policy used to hold approvals only, so a key somebody
 *    deliberately unticked was indistinguishable from one they had never seen —
 *    it was re-proposed on every run, and a later model that called it safe
 *    would pre-tick it again. An approval outranking a fresh opinion is the
 *    same rule read the other way round, and it used to live in a separate
 *    `approvalWins` pass in scripts/gjd-remote.ts; both halves are here now,
 *    because two functions applying half a rule each is how they came apart.
 * 3. **Only an undecided row is pre-ticked from the proposal**, and only under
 *    `preTick: "proposal"`.
 */
export function planChecklist(input: ChecklistInput): ChecklistItem[] {
  const approved = input.approved ?? new Set<string>();
  /* A policy written before `reviewed` existed reads as "the approvals are the
     decisions", which is the only migration that cannot un-approve anything. */
  const reviewed = input.reviewed ?? approved;
  return input.names.map((name) => planRow(name, input, approved, reviewed));
}

function planRow(
  name: string,
  input: ChecklistInput,
  approved: ReadonlySet<string>,
  reviewed: ReadonlySet<string>,
): ChecklistItem {
  const isNew = !approved.has(name);
  if (input.forbiddenNames.has(name)) {
    return { name, checked: false, disabled: true, description: FORBIDDEN_WHY, new: isNew };
  }
  if (input.valueGuard(name) === "not-local") {
    return { name, checked: false, disabled: true, description: NOT_LOCAL_WHY, new: isNew };
  }
  const proposed = input.proposal?.get(name);
  if (reviewed.has(name)) {
    const yes = approved.has(name);
    return {
      name,
      checked: yes,
      disabled: false,
      description: yes ? describe(proposed, false) : untickedWhy(input.savedAt),
      new: isNew,
    };
  }
  const checked =
    input.preTick === "proposal" && proposed !== undefined && SAFE_CLASSES.includes(proposed.class);
  return { name, checked, disabled: false, description: describe(proposed, true), new: isNew };
}

function describe(proposed: ProposedKey | undefined, isNew: boolean): string {
  const seen = isNew ? "not sent before" : "sent before";
  if (proposed === undefined) return `${seen} · no proposal for this key`;
  return `${seen} · ${proposed.class}: ${proposed.reason}`;
}

/** The row for a key the reader looked at and left unticked. It says who decided
 *  rather than what a model thinks, because that is the whole point of
 *  remembering it — and the model's reason is deliberately not repeated beside
 *  it, so a classifier calling it safe cannot read as an invitation. */
function untickedWhy(savedAt: string | undefined): string {
  const when = savedAt === undefined ? "before" : `on ${savedAt.slice(0, 10)}`;
  return `you unticked this ${when} — tick it to change your mind`;
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
  | { kind: "policy"; repo: string; approved: string[]; reviewed: string[]; savedAt: string }
  | { kind: "absent" }
  | { kind: "error"; why: string };

/** A policy that was read without failing: the saved one, or nothing saved yet.
 *  `pushEnvPlan` takes this rather than `PolicyRead`, so an unreadable file
 *  cannot be handed to it as "nothing approved" — the two are indistinguishable
 *  downstream and one of them silently overwrites the file it could not read. */
export type SavedPolicy = Exclude<PolicyRead, { kind: "error" }>;

/**
 * What gets written. `repo` is in the file so the filename is not the only thing
 * saying which repo this is.
 *
 * **`reviewed` is every name the reader has decided about; `approved` is the
 * subset they said yes to.** Two lists rather than one because a "no" has to
 * survive too — GPT Sol's Stage 4 finding 1. `approved ⊆ reviewed` is an
 * invariant, checked on the way in and on the way out.
 */
export type Policy = { repo: string; approved: readonly string[]; reviewed: readonly string[] };

const POLICY_KEYS = ["repo", "approved", "reviewed", "saved_at"] as const;

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
 * **A file with no `reviewed` list is one written before that list existed, and
 * it reads as `reviewed = approved`.** That is the only migration that cannot
 * change an answer: every name in it was ticked, so treating the approvals as
 * the decisions loses nothing, and every other name goes back to being
 * undecided — which it was. `reviewed` present but missing a name that
 * `approved` has is not a migration, it is a corrupt file, and it is an error.
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
  const list = readNameList(file, table.approved, "approved");
  if (typeof list === "string") return { kind: "error", why: list };
  const approved = list;
  /* Absent is the migration; present is checked. See the docblock. */
  const reviewedList =
    table.reviewed === undefined ? [...approved] : readNameList(file, table.reviewed, "reviewed");
  if (typeof reviewedList === "string") return { kind: "error", why: reviewedList };
  const undecided = approved.filter((n) => !reviewedList.includes(n));
  if (undecided.length > 0) {
    return {
      kind: "error",
      why: `${file} approves '${undecided[0]}' but does not list it as reviewed`,
    };
  }
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
  return { kind: "policy", repo, approved, reviewed: reviewedList, savedAt };
}

/**
 * One of the policy's name arrays, validated — or the sentence saying why it is
 * not one.
 *
 * A `string` return means failure, which is the one shape that cannot be
 * confused with a list of names. Split out of `readPolicy` because that
 * function was one branch over the complexity limit, and this is the half of it
 * with its own rule: **an entry that is not a variable name is an error, not a
 * skip.** Skipping would silently un-approve a key somebody had hand-edited,
 * and the next run would present it as new.
 */
function readNameList(file: string, raw: unknown, key: "approved" | "reviewed"): string[] | string {
  if (!Array.isArray(raw)) return `${file} has no '${key}' list`;
  const names: string[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry !== "string" || !ENV_NAME.test(entry)) {
      return `${file} has an '${key}' entry that is not a variable name`;
    }
    if (names.includes(entry)) return `${file} lists '${entry}' twice under '${key}'`;
    names.push(entry);
  }
  return names;
}

/** The bytes for a policy. Separate from the writing so the round trip can be
 *  checked without a filesystem, and so the readback below compares text this
 *  function produced rather than text the disk happened to hold. */
export function serialisePolicy(policy: Policy, now: Date): string {
  for (const name of [...policy.approved, ...policy.reviewed]) {
    if (!ENV_NAME.test(name)) {
      throw new EnvPolicyError(`'${name}' is not a variable name and will not be written down`);
    }
  }
  /* The invariant, refused rather than repaired. A policy that approves a name
     it does not record as decided is one this file could not read back, and
     "widen `reviewed` for them" would be this function inventing a decision
     nobody made. */
  const orphan = [...policy.approved].find((n) => !policy.reviewed.includes(n));
  if (orphan !== undefined) {
    throw new EnvPolicyError(
      `'${orphan}' would be approved without being recorded as decided, so nothing was written.`,
    );
  }
  const approved = [...new Set(policy.approved)].sort();
  const reviewed = [...new Set(policy.reviewed)].sort();
  return [
    `# Which .env.local keys you decided about for ${policy.repo}, and what you decided.`,
    "# Written by `gjd-remote push-env`. Key NAMES only — no value has ever been",
    "# read into this file, or into the model call that proposed them.",
    "#",
    "# approved  goes on the box, and starts ticked next time.",
    "# reviewed  every name you have answered for. A name in here and not in",
    "#           approved is one you unticked: it starts unticked next time, and",
    "#           no model is asked about it again.",
    "",
    `repo = ${JSON.stringify(policy.repo)}`,
    `saved_at = ${now.toISOString()}`,
    tomlNames("approved", approved),
    tomlNames("reviewed", reviewed),
    "",
  ].join("\n");
}

function tomlNames(key: string, names: readonly string[]): string {
  if (names.length === 0) return `${key} = []`;
  return `${key} = [\n${names.map((n) => `  ${JSON.stringify(n)},`).join("\n")}\n]`;
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

// ----------------------------------------------------- part 5: the whole plan

/**
 * **The two hard guards, built from the file's own bytes.**
 *
 * This is the one place a value is compared against anything, and only a verdict
 * leaves the closure. `localityVerdict` is the SAME call `buildEnvPayload`
 * refuses on (scripts/gjd-remote-env.ts), not a second spelling of it, so a row
 * cannot be tickable here and rejected there after the reader has answered every
 * question.
 *
 * A name the file does not define is `"ok"`: there is no value to judge, and
 * `buildEnvPayload` reports it as missing rather than sending an empty one.
 */
export function envGuards(text: string): Guards {
  const { values } = scanEnv(text);
  return {
    forbiddenNames: new Set(FORBIDDEN_NAMES),
    valueGuard: (name) => {
      const value = values.get(name);
      if (value === undefined) return "ok";
      return localityVerdict(name, value) === "not-local" ? "not-local" : "ok";
    },
  };
}

/** Names across several lines rather than one very long one. Names only ever —
 *  this is the list printed above the final confirmation. */
export function wrapNames(names: readonly string[], width = 76): string[] {
  const lines: string[] = [];
  let line = "";
  for (const name of names) {
    if (line === "") line = name;
    else if (line.length + 2 + name.length <= width) line += `, ${name}`;
    else {
      lines.push(`${line},`);
      line = name;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

/** How a line the plan wants printed should look. The plan does not import a
 *  colour function; the CLI owns the terminal. */
export type EnvPlanTone = "plain" | "dim" | "warn" | "bad";

/** What `push-env` needs from the outside world, all of it injected. Every one
 *  of these is a thing the CLI does — money, prompts, printing — and every one
 *  of them is a sink the leak test can watch. */
export type EnvPlanDeps = {
  /** The laptop's `.env.local`, whole. The only value-bearing input. */
  text: string;
  /** Where it was read from. Printed, and named in refusals. */
  local: string;
  /** The repo it belongs to. Goes in the policy and in the payload's banner. */
  slug: string;
  /** The saved policy, already read. Never the `error` arm — see `SavedPolicy`. */
  saved: SavedPolicy;
  flags: { propose: boolean; all: boolean; none: boolean; save: boolean; yes: boolean };
  /** The paid call. Given NAMES and the reason it is being made; answers with a
   *  proposal, or `undefined` for "there is none, carry on without one". Called
   *  at most once, and not at all when nothing is undecided. */
  propose: (names: readonly string[], why: string) => Promise<Map<string, ProposedKey> | undefined>;
  /** The checklist. Not called under `--all` or `--none`. */
  choose: (items: readonly ChecklistItem[]) => Promise<readonly string[]>;
  /** The last question. Not called under `--yes`. */
  confirm: (names: readonly string[]) => Promise<boolean>;
  /** Everything the reader sees, in order. Names and canned reasons only. */
  say: (line: string, tone: EnvPlanTone) => void;
};

/**
 * What to do, once everything has been asked. `payload` and `policyToSave` are
 * separately absent because they are separately conditional: a declined
 * confirmation writes neither, `--none --save` writes only the policy, and an
 * ordinary push writes both — the box first, so the file records what actually
 * travelled.
 */
export type EnvPlan = {
  /** The names going to the box, in checklist order. Empty when none are. */
  send: string[];
  /** The bytes for the box. **The only value-bearing thing this returns.** */
  payload: EnvPayload | undefined;
  /** What to write to `~/.config/gjd-remote/repos/`, or nothing. */
  policyToSave: Policy | undefined;
};

/**
 * **`push-env` for a repo with no written-down list: names, a proposal, a
 * checklist, and what you decided remembered.**
 *
 * The order below is the whole design, and each step is where it is for a
 * reason.
 *
 * 1. **The names come out first**, and the file's text goes nowhere else except
 *    into `buildEnvPayload` at the very end. Everything between — the model
 *    call, the rows on screen, the confirmation, the saved policy — is typed
 *    against names.
 * 2. **A file that would lose keys is refused before the model is asked.** The
 *    same refusal the typed path makes, moved earlier: asking a paid classifier
 *    about a name list that is missing entries, then making somebody answer a
 *    checklist built from it, and only then refusing, spends money and time to
 *    arrive where we already were.
 * 3. **The model is asked only about names nobody has decided on**, which is
 *    what `reviewed` buys (GPT Sol's Stage 4 finding 1). A second run of a repo
 *    where every eligible key has been ticked or unticked costs nothing and
 *    asks nothing.
 * 4. **The guards are applied twice**, and neither time is the important one on
 *    its own: greyed out in the checklist so the reader can see them, and
 *    re-applied to whatever comes back, because a checkbox library's `disabled`
 *    is presentation and `--all` never went through the library at all.
 * 5. **The policy is worked out from what travelled**, not from what was hoped
 *    for, and the caller writes it after the box.
 *
 * Refusals are `EnvPolicyError`, in the CLI's voice, because there is nothing
 * useful this can return when the file itself is unpushable.
 */
export async function pushEnvPlan(deps: EnvPlanDeps): Promise<EnvPlan> {
  const { names, problems } = extractEnvKeyNames(deps.text);
  deps.say(`reading ${deps.local} — ${names.length} key name(s), no values`, "dim");
  if (problems.length > 0) {
    throw new EnvPolicyError(
      `${deps.local} is not a file I will push — I would silently drop keys out of it:\n` +
        problems.map((p) => `  ${p}`).join("\n") +
        `\n  Fix those lines and run this again. Nothing was sent, and no model was asked.` +
        `\n  (Line numbers only — the contents of a broken line may well be the secret.)`,
    );
  }
  if (names.length === 0) {
    throw new EnvPolicyError(`${deps.local} has no keys in it at all, so there is nothing to send.`);
  }

  const saved = deps.saved.kind === "policy" ? deps.saved : undefined;
  const approved = saved === undefined ? undefined : new Set(saved.approved);
  const reviewed = saved === undefined ? undefined : new Set(saved.reviewed);

  const guards = envGuards(deps.text);
  /* A key that can never be sent can never be decided either, so it would stay
     undecided for the life of the repo — and asking the model about it is a paid
     call, every push, for a row that is greyed out on arrival. Found live on
     2026-09-02: the second run of this on gjdutils asked again about
     DATABASE_URL_PROD and HETZNER_CLOUD_API_TOKEN, which is every run forever. */
  const blocked = new Set(
    names.filter((n) => guards.forbiddenNames.has(n) || guards.valueGuard(n) === "not-local"),
  );

  const why = proposalReason(names, reviewed, blocked, deps.flags.propose);
  let proposal: Map<string, ProposedKey> | undefined;
  if (why === null) deps.say("no keys you have not decided on — skipping the model", "dim");
  else proposal = await deps.propose(names, why);

  const items = planChecklist({
    names,
    proposal,
    approved,
    reviewed,
    savedAt: saved?.savedAt,
    // Greg's call, 2026-09-02: for a key nobody has decided yet, the model's
    // answer IS the starting state, with the reason on each row. The plan
    // records GPT Sol's objection to that and that it was overruled —
    // docs/plans/260902h-…, "Open questions for Greg".
    preTick: "proposal",
    ...guards,
  });

  const chosen = await chooseNames(items, deps);
  const { send, refused } = applyGuards(chosen, items, guards);
  for (const r of refused) deps.say(`✗ ${r.name}  ${r.why}`, "bad");
  const decided = nextPolicyNames(items, send, saved);

  if (send.length === 0) {
    deps.say("nothing selected, so nothing was written to the box.", "warn");
    if (!deps.flags.save) {
      deps.say("--save would record those answers; without it, nothing is remembered.", "dim");
      return { send: [], payload: undefined, policyToSave: undefined };
    }
    return { send: [], payload: undefined, policyToSave: { repo: deps.slug, ...decided } };
  }

  for (const line of wrapNames(send)) deps.say(`  ${line}`, "plain");
  if (!deps.flags.yes && !(await deps.confirm(send))) {
    deps.say("nothing was sent.", "plain");
    return { send: [], payload: undefined, policyToSave: undefined };
  }
  return {
    send,
    payload: buildEnvPayload(deps.text, { names: send, source: `you approved for ${deps.slug}` }),
    policyToSave: { repo: deps.slug, ...decided },
  };
}

/** The checklist, or the flag that stands in for it. `--all` means every
 *  SELECTABLE row — `selectableNames` rather than a map over the items, so
 *  "select all" and the guard cannot come to different conclusions. */
async function chooseNames(
  items: readonly ChecklistItem[],
  deps: EnvPlanDeps,
): Promise<readonly string[]> {
  if (deps.flags.none) {
    deps.say("--none: nothing selected", "dim");
    return [];
  }
  if (deps.flags.all) {
    const all = selectableNames(items);
    deps.say(`--all: ${all.length} of ${items.length} rows are selectable`, "dim");
    return all;
  }
  return deps.choose(items);
}

/**
 * **Whether to ask the model, and the line saying why.** `null` is "do not ask".
 *
 * Not asked every time: a repo where every eligible name has been ticked or
 * unticked has nothing to classify, and a paid call per push is a paid call for
 * an answer nobody reads. `--propose` forces it, which is how you get a fresh
 * opinion after editing the policy by hand.
 *
 * It counts UNDECIDED names, not unapproved ones. Counting unapproved ones is
 * finding 1 in one line: `--none --save` would then ask again on the very next
 * run, about the exact keys the reader had just said no to.
 */
function proposalReason(
  names: readonly string[],
  reviewed: ReadonlySet<string> | undefined,
  blocked: ReadonlySet<string>,
  forced: boolean,
): string | null {
  if (forced) return "--propose";
  if (reviewed === undefined) return "no saved policy for this repo yet";
  const undecided = names.filter((n) => !blocked.has(n) && !reviewed.has(n));
  return undecided.length > 0 ? `${undecided.length} key(s) you have not decided on` : null;
}

/**
 * **What the policy should say afterwards.**
 *
 * `reviewed` grows and never shrinks; `approved` is replaced for the names on
 * this checklist and left alone for the ones that were not.
 *
 * Two deliberate consequences:
 *
 * - **A key deleted from `.env.local` keeps its answer.** It was not on the
 *   checklist, so the reader made no decision about it today, and dropping it
 *   would mean that re-adding a key you had rejected re-proposed it as if it
 *   were new. It costs a stale name in a list nothing iterates.
 * - **A key that has since become ineligible loses its approval**, because it
 *   IS on the checklist — greyed out — and can never be sent again. It stays in
 *   `reviewed`, so it is not re-proposed either.
 */
function nextPolicyNames(
  items: readonly ChecklistItem[],
  send: readonly string[],
  saved: { approved: readonly string[]; reviewed: readonly string[] } | undefined,
): { approved: string[]; reviewed: string[] } {
  const shown = new Set(items.map((i) => i.name));
  const untouched = (saved?.approved ?? []).filter((n) => !shown.has(n));
  const approved = [...new Set([...send, ...untouched])];
  const reviewed = [
    ...new Set([...(saved?.reviewed ?? []), ...selectableNames(items), ...approved]),
  ];
  return { approved, reviewed };
}
