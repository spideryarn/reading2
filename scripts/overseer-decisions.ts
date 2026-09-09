#!/usr/bin/env -S npx tsx
/**
 * `overseer-decisions` — record and inspect delegated decisions from a terminal.
 *
 *     npx tsx scripts/overseer-decisions.ts template > /tmp/decision.json
 *     npx tsx scripts/overseer-decisions.ts add --file /tmp/decision.json --by overseer
 *
 * The template is the ergonomic centre: the Overseer writes these while work
 * is moving, and one structured file is easier to inspect than nine shell flags
 * with quoting spread between them.
 *
 * **`--by` is required on every write and never defaulted.** This record is the
 * counterparty to delegated authority; a write with nobody's name on it is
 * exactly what it must refuse. Defaulting to Greg would let an agent mint his
 * authority merely by omitting a flag.
 *
 * **It remains a self-declaration, not proven identity.** Anything running as
 * this Unix user can pass `--by greg`, or append such a line directly. Only
 * Greg's review events are honoured by the fold, but this is a governance
 * constraint rather than an OS boundary. Saying otherwise would advertise a
 * protection the file does not have.
 *
 * Session executions are looked up at decision time, the only moment a reusable
 * pane name can still be joined to a particular run. The three result arms keep
 * "not there" separate from "could not look" without ever refusing a decision.
 *
 * `console.log` is correct here: docs/project/logging.md's rule follows the
 * destination, and this destination is a terminal rather than a server log.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Command, InvalidArgumentError } from "commander";

import {
  DECISIONS_FILE,
  ID_RULE,
  appendEvents,
  decisionsRoot,
  envelope,
  mintId,
  parseEvent,
  readDecisions,
  spellVersion,
  viewOf,
  type Adviser,
  type BearsOn,
  type DecisionActor,
  type DecisionClass,
  type DecisionEvent,
  type DecisionOption,
  type DecisionView,
  type SessionRef,
} from "../tools/overseer/decisions.js";
import { readCheckpoint, storeRoot, type RegisterEntry } from "../tools/overseer/store.js";

const TEMPLATE = `// Copy this to a file, replace the examples, then run:
// npx tsx scripts/overseer-decisions.ts add --file <that-file> --by overseer
{
  "class": "decision",
  "question": "Which shape should the first version use?",
  "options": [
    { "name": "Small", "tradeoffs": "Ships quickly, with fewer extension points." },
    { "name": "General", "tradeoffs": "Handles imagined cases, with more machinery." }
  ],
  "chose": { "option": "Small", "note": "Use the small shape." },
  "why": "There is no demonstrated need for the extension points.",
  "advisers": ["nobody"],
  "bearsOn": { "sessions": [], "plan": null },
  "supersedes": null
}`;

function actor(value: string): DecisionActor {
  if (value === "greg" || value === "overseer") return value;
  throw new InvalidArgumentError(`actor must be 'greg' or 'overseer', not '${value}'`);
}

function decisionId(value: string): string {
  if (ID_RULE.test(value)) return value;
  throw new InvalidArgumentError(`'${value}' is not a decision id (they look like dec-a3k9mq2p)`);
}

export type Parsed =
  | { command: "template" }
  | { command: "add"; file: string; by: DecisionActor; commandId: string | null }
  | { command: "show"; id: string }
  | { command: "export" }
  | { command: "reviewed"; id: string; by: DecisionActor; note: string | null }
  | { command: "reversed"; id: string; by: DecisionActor; why: string | null };

/** The grammar only. Every action routes its typed result through `sink`. */
export function buildProgram(sink: (parsed: Parsed) => void = () => {}): Command {
  const program = new Command();
  program.name("overseer-decisions").description("the Overseer's reviewable record of delegated decisions").exitOverride();

  program.command("template").description("print a commented JSON input for add --file").action(() => sink({ command: "template" }));

  program
    .command("add")
    .description("append a decided event from a JSON file, or stdin with --file -")
    .requiredOption("--file <path|->", "the decision input")
    .requiredOption("--by <actor>", "who records it: greg or overseer", actor)
    .option("--command-id <id>", "idempotency key for a retry")
    .action((opts: { file: string; by: DecisionActor; commandId?: string }) =>
      sink({ command: "add", file: opts.file, by: opts.by, commandId: opts.commandId ?? null }),
    );

  program
    .command("show")
    .description("show one decision and its accepted history")
    .argument("<id>", "decision id", decisionId)
    .action((id: string) => sink({ command: "show", id }));

  program.command("export").description("print the raw event log for piping").action(() => sink({ command: "export" }));

  program
    .command("reviewed")
    .description("record that Greg reviewed a decision")
    .argument("<id>", "decision id", decisionId)
    .requiredOption("--by <actor>", "who records it: greg or overseer", actor)
    .option("--note <text>", "optional review note")
    .action((id: string, opts: { by: DecisionActor; note?: string }) =>
      sink({ command: "reviewed", id, by: opts.by, note: opts.note ?? null }),
    );

  program
    .command("reversed")
    .description("record that Greg reversed a decision")
    .argument("<id>", "decision id", decisionId)
    .requiredOption("--by <actor>", "who records it: greg or overseer", actor)
    .option("--why <text>", "optional reason for reversal")
    .action((id: string, opts: { by: DecisionActor; why?: string }) =>
      sink({ command: "reversed", id, by: opts.by, why: opts.why ?? null }),
    );

  // Commander copies parser/output settings when a child is created. Restore
  // help and exit overrides after the complete tree exists, as overseer.ts does.
  for (const command of program.commands) {
    command.helpOption("-h, --help", "what this command takes");
    command.exitOverride();
  }
  return program;
}

export type ParseOutcome =
  | { kind: "run"; parsed: Parsed }
  | { kind: "help"; text: string }
  | { kind: "error"; why: string };

export function parseArgv(argv: readonly string[]): ParseOutcome {
  let parsed: Parsed | undefined;
  const program = buildProgram((value) => {
    parsed = value;
  });
  let out = "";
  let err = "";
  const capture = {
    writeOut: (text: string) => {
      out += text;
    },
    writeErr: (text: string) => {
      err += text;
    },
  };
  program.configureOutput(capture);
  for (const command of program.commands) command.configureOutput(capture);
  try {
    program.parse([...argv], { from: "user" });
  } catch (cause) {
    const commander = cause as { exitCode?: number };
    if (commander.exitCode === 0) return { kind: "help", text: out.trimEnd() };
    return {
      kind: "error",
      why: err.trim() || (cause instanceof Error ? cause.message : String(cause)),
    };
  }
  if (parsed === undefined) return { kind: "error", why: "no command was given; use --help" };
  return { kind: "run", parsed };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type AddInput = {
  class: DecisionClass;
  question: string;
  options: readonly DecisionOption[];
  chose: { readonly option: string; readonly note: string | null };
  why: string;
  advisers: readonly Adviser[];
  sessionNames: readonly string[];
  plan: string | null;
  supersedes: string | null;
};

/** Full-line comments are the only extension the generated template needs. */
function stripTemplateComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

/**
 * Validate an add input by forming the real event and passing it through the
 * record's one strict parser. The CLI input differs in one deliberate place:
 * sessions are names, because their execution tokens are facts this command
 * resolves rather than values a caller is allowed to assert.
 */
function parseAddInput(text: string): AddInput {
  let value: unknown;
  try {
    value = JSON.parse(stripTemplateComments(text));
  } catch (cause) {
    throw new Error(`the decision input is not JSON: ${String(cause)}`);
  }
  if (!isRecord(value) || !isRecord(value["bearsOn"])) throw new Error("the decision input needs a bearsOn object");
  const rawSessions = value["bearsOn"]["sessions"];
  if (!Array.isArray(rawSessions) || rawSessions.some((name) => typeof name !== "string")) {
    throw new Error("bearsOn.sessions must be an array of session names");
  }
  const sessionNames = rawSessions as string[];
  const provisional: unknown = {
    ...envelope("overseer", { at: "2026-09-09T00:00:00.000Z" }),
    kind: "decided",
    id: "dec-22222222",
    decidedAt: "2026-09-09T00:00:00.000Z",
    class: value["class"],
    question: value["question"],
    options: value["options"],
    chose: value["chose"],
    why: value["why"],
    advisers: value["advisers"],
    bearsOn: {
      sessions: sessionNames.map((name) => ({
        name,
        execution: { kind: "unavailable", why: "provisional CLI validation" },
      })),
      plan: value["bearsOn"]["plan"],
    },
    supersedes: value["supersedes"],
  };
  const checked = parseEvent(JSON.stringify(provisional));
  if (checked === null || checked.kind !== "decided") {
    throw new Error("the decision input is incomplete or invalid; compare it with `template`");
  }
  return {
    class: checked.class,
    question: checked.question,
    options: checked.options,
    chose: checked.chose,
    why: checked.why,
    advisers: checked.advisers,
    sessionNames,
    plan: checked.bearsOn.plan,
    supersedes: checked.supersedes,
  };
}

type RegisterLookup =
  | { readonly kind: "available"; readonly entries: readonly RegisterEntry[] }
  | { readonly kind: "unavailable"; readonly why: string };

function registerEntries(env: NodeJS.ProcessEnv, nowMs: number = Date.now()): RegisterLookup {
  try {
    const read = readCheckpoint(storeRoot(env));
    if (read.kind === "absent") return { kind: "unavailable", why: "the Overseer checkpoint is absent" };
    if (read.kind === "unusable") {
      return { kind: "unavailable", why: `the Overseer checkpoint is unreadable (${read.why}: ${read.detail})` };
    }
    const checkpoint = read.checkpoint;
    if (checkpoint.lastGoodSnapshotAt === null) {
      return { kind: "unavailable", why: "the Overseer checkpoint has no accepted snapshot" };
    }
    if (checkpoint.snapshotStaleAfterMs === null) {
      return { kind: "unavailable", why: "the Overseer checkpoint has no snapshot staleness bound" };
    }
    const ageMs = nowMs - Date.parse(checkpoint.lastGoodSnapshotAt);
    if (ageMs > checkpoint.snapshotStaleAfterMs) {
      return {
        kind: "unavailable",
        why:
          `the Overseer checkpoint is stale (${Math.round(ageMs / 1000)}s old; ` +
          `its bound is ${Math.round(checkpoint.snapshotStaleAfterMs / 1000)}s)`,
      };
    }
    return { kind: "available", entries: checkpoint.register };
  } catch (cause) {
    // A bad store setting or unreadable checkpoint is an unavailable identity
    // source, not permission to invent one and not a reason to lose the record.
    return { kind: "unavailable", why: `the Overseer checkpoint could not be read: ${String(cause)}` };
  }
}

function resolveSessions(names: readonly string[], env: NodeJS.ProcessEnv): SessionRef[] {
  const lookup = registerEntries(env);
  if (lookup.kind === "unavailable") {
    return names.map((name) => ({ name, execution: { kind: "unavailable", why: lookup.why } }));
  }
  return names.map((name) => {
    const matches = lookup.entries.filter((entry) => entry.name === name);
    if (matches.length > 1) {
      const why = `session ${name} is ambiguous in the register (${matches.length} entries)`;
      console.log(`${why}; stored execution unavailable`);
      return { name, execution: { kind: "unavailable", why } };
    }
    const match = matches[0];
    if (match === undefined) return { name, execution: { kind: "not-found" } };
    if (match.verifiedExecution === null) {
      return {
        name,
        execution: { kind: "unavailable", why: `the register has no verified execution for session ${name}` },
      };
    }
    return { name, execution: { kind: "verified", ...match.verifiedExecution } };
  });
}

function requireView(root: string): DecisionView {
  const read = readDecisions(root);
  const view = viewOf(read);
  if (view !== null) return view;
  throw new Error(read.kind === "unreadable" ? read.why : `could not read the decision record at ${root}`);
}

function appendOne(event: DecisionEvent, root: string): number {
  const result = appendEvents([event], { root });
  if (!result.ok) {
    console.error(`✗ ${result.why}`);
    return 1;
  }
  console.log(`${event.id}\nversion ${spellVersion(result.view.version)}`);
  return 0;
}

export function runParsed(
  parsed: Parsed,
  env: NodeJS.ProcessEnv = process.env,
  readStdin: () => string = () => readFileSync(0, "utf8"),
): number {
  const root = decisionsRoot(env);
  switch (parsed.command) {
    case "template":
      console.log(TEMPLATE);
      return 0;
    case "add": {
      const text = parsed.file === "-" ? readStdin() : readFileSync(path.resolve(parsed.file), "utf8");
      const input = parseAddInput(text);
      const bearsOn: BearsOn = { sessions: resolveSessions(input.sessionNames, env), plan: input.plan };
      const eventEnvelope = envelope(parsed.by, { commandId: parsed.commandId });
      const event: DecisionEvent = {
        ...eventEnvelope,
        kind: "decided",
        id: mintId(),
        decidedAt: eventEnvelope.at,
        class: input.class,
        question: input.question,
        options: input.options,
        chose: input.chose,
        why: input.why,
        advisers: input.advisers,
        bearsOn,
        supersedes: input.supersedes,
      };
      return appendOne(event, root);
    }
    case "show": {
      const record = requireView(root).records.find((candidate) => candidate.id === parsed.id);
      if (record === undefined) {
        console.error(`✗ no decision ${parsed.id}`);
        return 1;
      }
      console.log(JSON.stringify(record, null, 2));
      return 0;
    }
    case "export": {
      const read = readDecisions(root);
      if (read.kind === "unreadable") throw new Error(read.why);
      if (read.kind === "never-written") return 0;
      console.log(readFileSync(path.join(root, DECISIONS_FILE), "utf8").trimEnd());
      return 0;
    }
    case "reviewed":
      return appendOne(
        { ...envelope(parsed.by), kind: "reviewed", id: parsed.id, note: parsed.note },
        root,
      );
    case "reversed":
      return appendOne(
        { ...envelope(parsed.by), kind: "reversed", id: parsed.id, why: parsed.why },
        root,
      );
    default: {
      const never: never = parsed;
      throw new Error(`unhandled command ${JSON.stringify(never)}`);
    }
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const outcome = parseArgv(argv);
  if (outcome.kind === "help") {
    console.log(outcome.text);
    return 0;
  }
  if (outcome.kind === "error") {
    console.error(outcome.why);
    return 1;
  }
  try {
    return runParsed(outcome.parsed);
  } catch (cause) {
    console.error(`✗ ${cause instanceof Error ? cause.message : String(cause)}`);
    return 1;
  }
}

function isMain(): boolean {
  const invoked = process.argv[1];
  return invoked !== undefined && invoked === fileURLToPath(import.meta.url);
}

if (isMain()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((cause: unknown) => {
      console.error(`✗ ${cause instanceof Error ? cause.message : String(cause)}`);
      process.exitCode = 1;
    });
}
