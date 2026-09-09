/**
 * `overseer-queue` — read and write the queue of ideas from a terminal.
 *
 *     npx tsx scripts/overseer-queue.ts list
 *     npx tsx scripts/overseer-queue.ts --help      # every command and flag
 *
 * **A CLI as well as a page, because the Overseer works from a terminal.** The
 * dashboard is how Greg reorders the queue on a phone; this is how the Overseer
 * records that an item was dispatched, and how anybody reads the queue when the
 * dashboard is the thing that is broken. Same module, same lock, same file
 * ([`idea-queue.ts`](../tools/overseer/idea-queue.ts)) — there is no second
 * writer with its own opinions, and the version check a route makes is the one
 * this makes.
 *
 * **`--by` IS REQUIRED ON EVERY WRITE AND IS NOT DEFAULTED.** The queue is gate
 * 3's authorisation record, so a write with nobody's name on it is exactly the
 * thing it must refuse; defaulting to `greg` would let an agent mint his
 * authority by omission. `docs/project/overseer.md` § gate 1.
 *
 * **And `--by` is a self-declaration, not a proven identity.** Anything running
 * as this user can pass `--by greg`, here or by appending to the file directly.
 * That is equally true of the Markdown file this replaces, so nothing is lost —
 * but it means gate 3 is a governance constraint rather than an OS boundary, and
 * saying so is better than implying a protection that is not there. GPT Sol's
 * P0-1; `idea-queue.ts` § gate 3 has the rest.
 *
 * `console.log` rather than src/log.ts, per docs/project/logging.md's rule: the
 * destination is a terminal.
 */
import { seedEvents } from "../tools/overseer/idea-queue-seed.js";
import {
  EMPTY_METADATA,
  ID_RULE,
  appendEvents,
  asPlacement,
  envelope,
  isDispatchable,
  mintId,
  queueRoot,
  readQueue,
  spellVersion,
  viewOf,
  whyNotDispatchable,
  type IdeaActor,
  type IdeaEvent,
  type IdeaItem,
  type IdeaMetadata,
  type Placement,
  type QueueVersion,
  type QueueView,
} from "../tools/overseer/idea-queue.js";
import { itemWait, queueDepth, throughput } from "../tools/overseer/idea-queue-wait.js";

const USAGE = `overseer-queue — the Overseer's queue of ideas

  list                              the queue in order, with why each item is or is not ready
  show <id>                         one item in full: authority, revision, and its history
  add --by <who> --text <words>     [--title T] [--source P] [--waiting-on W] [--size S]
                                    [--runs D] [--areas a,b] [--needs-greg]
                                    where: --front | --back (default) | --before <id> | --after <id>
  authorize <id> --by greg          Greg says yes to the item AS IT NOW READS
  move <id> --by <who>              --front | --back | --before <id> | --after <id>
  edit <id> --by <who>              [--text T] [--title T] [--source P] [--waiting-on W]
                                    [--size S] [--runs D] [--areas a,b]
                                    [--needs-greg | --ready]   --ready is GREG'S ONLY
                                    clear a field with --clear-title, --clear-source,
                                    --clear-waiting-on, --clear-size, --clear-runs
  dispatched <id> --by <who> --session <name> [--plan P]
  done <id> --by <who>
  drop <id> --by <who> [--why W]
  seed                              the sixteen clusters from overseer-queue.md, AS PROPOSALS, into
                                    an empty queue; prints the authorize commands for Greg
  export [--json]                   every item as one line each, or the folded queue as JSON

  THREE THINGS ARE TRUE OF AN ITEM AND THEY ARE DIFFERENT QUESTIONS:
    authority   proposed, or authorised by Greg FOR A PARTICULAR REVISION
    lifecycle   queued, dispatched, done, dropped
    needs-greg  waiting on an answer rather than on a slot

  So an item only goes out when all of: the queue read cleanly, Greg authorised
  it, he authorised THIS revision, it is still queued, and it is not waiting on
  him. \`list\` marks those: ? needs Greg, ! nobody has authorised it, > running.

  --by is 'greg' or 'overseer' and is required on every write: this file is an
  authorisation record, so a write with nobody's name on it is refused. Only
  Greg can authorise, and an edit by anyone else LAPSES his approval — that is
  deliberate, so an item cannot be approved and then quietly enlarged. Only he
  can --ready an item either: noticing that something needs him is the
  coordinator's job, and deciding it no longer does is the answer itself.

  --root <dir> overrides OVERSEER_QUEUE_DIR (default ~/.overseer).
`;

type Flags = { readonly words: readonly string[]; readonly flags: ReadonlyMap<string, string | true> };

/**
 * `--key value`, `--key=value` and bare `--flag`.
 *
 * A value that begins with `-` is treated as the next flag rather than as this
 * one's value, so `--title --front` is a missing title rather than a title of
 * `--front`. Hand-rolled because this is one small script and the repo has no
 * arg-parsing dependency to reach for.
 */
function parseArgs(argv: readonly string[]): Flags {
  const words: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (!arg.startsWith("--")) {
      words.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      flags.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("-")) {
      flags.set(body, next);
      i += 1;
    } else {
      flags.set(body, true);
    }
  }
  return { words, flags };
}

function fail(why: string): never {
  console.error(`✗ ${why}`);
  process.exit(2);
}

function str(flags: Flags["flags"], key: string): string | null {
  const value = flags.get(key);
  if (value === undefined) return null;
  if (value === true) fail(`--${key} needs a value`);
  return value;
}

/** The actor, checked rather than defaulted. See the header. */
function actor(flags: Flags["flags"]): IdeaActor {
  const by = str(flags, "by");
  if (by === null) fail("--by is required: 'greg' or 'overseer'. See --help.");
  if (by !== "greg" && by !== "overseer") fail(`--by must be 'greg' or 'overseer', not '${by}'`);
  return by;
}

function idArg(words: readonly string[]): string {
  const id = words[1];
  if (id === undefined) fail("which item? pass its id — `list` prints them");
  if (!ID_RULE.test(id)) fail(`'${id}' is not a queue id (they look like qi-a3k9mq2p)`);
  return id;
}

function root(flags: Flags["flags"]): string {
  return str(flags, "root") ?? queueRoot();
}

/**
 * Read, or print why not and stop.
 *
 * **`unreadable` STOPS, and that is the point** — a CLI that prints a plausible
 * queue over a file it could not parse is the silent success this whole module
 * is built against. `never-written` is not that: it is an empty queue, and it
 * prints as one.
 */
function view(dir: string): QueueView {
  const read = readQueue(dir);
  const got = viewOf(read);
  if (got === null) fail(read.kind === "unreadable" ? read.why : `could not read the queue at ${dir}`);
  return got;
}

/* ------------------------------------------------------------------ *
 * Printing.
 * ------------------------------------------------------------------ */

/**
 * One character for what is true of a row — read off the three axes rather than
 * one field, because that is what there is now.
 *
 * `?` means *you*, `!` means *nobody has approved this*, and they are different
 * calls to action: the first wants an answer, the second wants a yes.
 */
function mark(view: QueueView, item: IdeaItem): string {
  if (item.lifecycle === "dispatched") return ">";
  if (item.lifecycle === "done") return "✓";
  if (item.lifecycle === "dropped") return "×";
  if (item.needsGreg) return "?";
  if (!isDispatchable(view, item)) return "!";
  return " ";
}

function describeItem(queue: QueueView, item: IdeaItem, position: number | null): string {
  const head = item.title ?? item.text;
  const oneLine = head.replace(/\s+/g, " ").trim();
  const shown = oneLine.length > 66 ? `${oneLine.slice(0, 65)}…` : oneLine;
  const bits: string[] = [];
  if (item.metadata.size !== null) bits.push(item.metadata.size);
  if (item.metadata.waitingOn !== null) bits.push(`waiting on ${item.metadata.waitingOn}`);
  if (item.lifecycle === "dispatched" && item.dispatchedTo !== null) bits.push(`as ${item.dispatchedTo}`);
  if (item.lifecycle === "dropped" && item.droppedWhy !== null) bits.push(item.droppedWhy);
  /* Why it cannot go out, on the row itself. The value of the three axes is
     lost if the list shows a mark and makes somebody run `show` to find out
     what it meant. `needsGreg` is skipped here because `waitingOn` above
     already says it, in the doc's own words. */
  if (item.lifecycle === "queued" && !item.needsGreg) {
    const why = whyNotDispatchable(queue, item);
    if (why !== null) bits.push(why);
  }
  const tail = bits.length === 0 ? "" : `\n      ${bits.join(" · ")}`;
  const rank = position === null ? "   " : `${String(position + 1).padStart(2)}.`;
  return `${rank} ${mark(queue, item)} ${item.id}  ${shown}${tail}`;
}

function printList(queue: QueueView): void {
  if (queue.items.length === 0 && queue.settled.length === 0) {
    console.log("The queue is empty. Nothing has been queued yet — which is not the same as nothing being wanted.");
  }
  if (queue.items.length > 0) {
    console.log(`In the queue (${queue.items.length}):\n`);
    queue.items.forEach((item, index) => {
      console.log(describeItem(queue, item, index));
    });
  }
  if (queue.settled.length > 0) {
    console.log(`\nSettled (${queue.settled.length}, newest first):\n`);
    for (const item of queue.settled) console.log(describeItem(queue, item, null));
  }

  const depth = queueDepth(queue);
  console.log(
    `\nversion ${spellVersion(queue.version)} · ${depth.dispatchable} ready, ${depth.needsGreg} need Greg, ` +
      `${depth.unauthorized} unauthorised, ${depth.dispatched} running`,
  );

  /* **THE OBSERVATIONS, NOT A FORECAST.** idea-queue-wait.ts says at length why
     there is no "about four days" on this line. */
  const rate = throughput(queue, Date.now());
  console.log(
    `recent: ${rate.windows.map((w) => `${w.dispatched} out / ${w.done} done in ${w.days}d`).join(" · ")}`,
  );
  console.log(`wait: ${rate.duration.why}`);

  /* **LOUD, AND LAST, SO IT IS THE LINE LEFT ON SCREEN.** A queue with a problem
     is a queue nothing may be dispatched from — and this file is original human
     input, not a disposable cache. */
  if (queue.problems.length > 0) {
    console.log(`\n⚠ ${queue.problems.length} PROBLEM(S) — nothing here is dispatchable until they are resolved:`);
    for (const problem of queue.problems) {
      console.log(`  ${problem.kind}: ${problem.why}${problem.eventId === null ? "" : ` (event ${problem.eventId})`}`);
    }
  }
}

function printShow(queue: QueueView, id: string): void {
  const item = [...queue.items, ...queue.settled].find((i) => i.id === id);
  if (item === undefined) fail(`no item ${id} in the queue`);
  console.log(`${item.id}  ${item.lifecycle}${item.needsGreg ? "  (needs Greg)" : ""}`);
  console.log(
    `authority: ${
      item.authority.kind === "proposed"
        ? "proposed — nobody has authorised it"
        : `authorised by ${item.authority.by} at ${item.authority.at} for revision ${item.authority.revision}` +
          (item.authority.revision === item.revision ? "" : `, and it is now revision ${item.revision} — LAPSED`)
    }`,
  );
  const why = whyNotDispatchable(queue, item);
  console.log(`dispatchable: ${why === null ? "yes" : `no — ${why}`}`);
  console.log(`wait: ${itemWait(queue, item).why}`);

  if (item.title !== null) console.log(`\n${item.title}`);
  console.log(`\n${item.text}\n`);
  const m = item.metadata;
  for (const [label, value] of [
    ["source", m.source],
    ["waiting on", m.waitingOn],
    ["size", m.size],
    ["runs", m.runs],
    ["areas", m.areas.length === 0 ? null : m.areas.join(", ")],
    ["dispatched to", item.dispatchedTo],
    ["plan", item.plan],
  ] as const) {
    if (value !== null) console.log(`  ${label}: ${value}`);
  }
  console.log(`\nHistory:`);
  for (const touch of item.history) console.log(`  ${touch.at}  ${touch.by.padEnd(8)}  ${touch.what}`);
}
/* ------------------------------------------------------------------ *
 * Writing.
 * ------------------------------------------------------------------ */

function metadataFrom(flags: Flags["flags"]): IdeaMetadata {
  const areas = str(flags, "areas");
  return {
    source: str(flags, "source"),
    waitingOn: str(flags, "waiting-on"),
    size: str(flags, "size"),
    areas: areas === null ? [] : areas.split(",").map((a) => a.trim()).filter((a) => a !== ""),
    runs: str(flags, "runs"),
  };
}

/**
 * The metadata half of an edit — only the keys the caller actually named.
 *
 * `--waiting-on x` sets it; `--clear-waiting-on` sets it to null; naming
 * neither leaves it alone. Three states, because "set to empty" and "do not
 * touch" are different intentions and a single flag cannot say which.
 */
function metadataPatch(flags: Flags["flags"]): Partial<IdeaMetadata> | undefined {
  const patch: Record<string, unknown> = {};
  for (const [flag, key] of [
    ["source", "source"],
    ["waiting-on", "waitingOn"],
    ["size", "size"],
    ["runs", "runs"],
  ] as const) {
    const value = str(flags, flag);
    if (value !== null) patch[key] = value;
    if (flags.get(`clear-${flag}`) !== undefined) patch[key] = null;
  }
  const areas = str(flags, "areas");
  if (areas !== null) {
    patch["areas"] = areas.split(",").map((a) => a.trim()).filter((a) => a !== "");
  }
  return Object.keys(patch).length === 0 ? undefined : (patch as Partial<IdeaMetadata>);
}

/**
 * Append, print the outcome, and exit non-zero if it was refused.
 *
 * The version is passed through so a CLI write is checked the same way a route
 * write is — one path, so the two cannot disagree about what a conflict is.
 * A torn line found on the way in is REPORTED rather than swallowed: it means a
 * writer died mid-append and those bytes are gone, which somebody should know.
 */
function write(dir: string, events: readonly IdeaEvent[], expect: QueueVersion, said: string): void {
  const result = appendEvents(events, { root: dir, expect });
  if (!result.ok) fail(`${result.why}${result.code === "stale-version" ? "" : ` [${result.code}]`}`);
  if (result.repaired.torn) {
    console.log(`⚠ repaired a torn final line first — ${result.repaired.droppedBytes} byte(s) were lost:`);
    console.log(`  ${result.repaired.droppedText.slice(0, 200)}`);
  }
  console.log(`✓ ${said}`);
  console.log(`  ${result.path} · version ${spellVersion(result.view.version)}`);
}

/** `--front`/`--back`/`--before ID`/`--after ID` to a placement. Defaults to the back. */
function placementFrom(flags: Flags["flags"]): Placement {
  const before = str(flags, "before");
  const after = str(flags, "after");
  if (before !== null && after !== null) fail("--before and --after say different things");
  if (before !== null) {
    const placement = asPlacement({ at: "before", anchor: before });
    if (placement === null) fail(`'${before}' is not a queue id`);
    return placement;
  }
  if (after !== null) {
    const placement = asPlacement({ at: "after", anchor: after });
    if (placement === null) fail(`'${after}' is not a queue id`);
    return placement;
  }
  if (flags.get("front") !== undefined) return { at: "front" };
  return { at: "back" };
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  const command = parsed.words[0] ?? "list";
  if (command === "help" || parsed.flags.get("help") !== undefined) {
    console.log(USAGE);
    return;
  }
  const dir = root(parsed.flags);

  switch (command) {
    case "list": {
      printList(view(dir));
      return;
    }
    case "show": {
      printShow(view(dir), idArg(parsed.words));
      return;
    }
    case "export": {
      const queue = view(dir);
      if (parsed.flags.get("json") !== undefined) {
        console.log(JSON.stringify(queue, null, 2));
        return;
      }
      /* The raw file, so a queue on the box can be moved, diffed or pasted into
         a bug report. This is the answer to "it is not versioned": it is one
         command away from being text you can put anywhere. */
      const read = readQueue(dir);
      const got = viewOf(read);
      if (got === null) fail(read.kind === "unreadable" ? read.why : `could not read the queue at ${dir}`);
      console.log(`# ${read.path}`);
      for (const item of [...got.items, ...got.settled]) console.log(JSON.stringify(item));
      return;
    }
    case "seed": {
      /* The one-time migration of overseer-queue.md's sixteen clusters.
         **Refuses a queue that already holds anything**, because the honest
         failure of a seed is "somebody ran it twice" and the result of not
         checking is thirty-two items with no way to tell which sixteen are the
         duplicates. `--force` exists for a test and says so. */
      const queue = view(dir);
      const populated = queue.items.length > 0 || queue.settled.length > 0;
      if (populated && parsed.flags.get("force") === undefined) {
        fail(
          `the queue at ${dir} already holds ${queue.items.length + queue.settled.length} item(s). ` +
            `Seeding is for an empty queue; pass --force only if you mean to add the sixteen again.`,
        );
      }
      const events = seedEvents({ at: new Date().toISOString() });
      const result = appendEvents(events, { root: dir, expect: queue.version });
      if (!result.ok) fail(`${result.why} [${result.code}]`);
      console.log(`✓ seeded ${events.length} clusters from overseer-queue.md AS PROPOSALS`);
      console.log(`  ${result.path} · version ${spellVersion(result.view.version)}`);
      /* **THE SEED DOES NOT AUTHORISE ANYTHING, and this is where that becomes
         visible rather than a sentence in a header.** `by` means *who recorded
         this*, and a script recorded these; Greg's approval is a separate,
         dated, attributed act by the only person who can make one. So the
         command prints what he has to run, in his own name, at cutover. */
      console.log(
        `\n  Nothing here is dispatchable yet — every row is a proposal, because a script recorded it\n` +
          `  and only Greg can authorise. At cutover, he runs:\n`,
      );
      for (const item of result.view.items) {
        console.log(`    npx tsx scripts/overseer-queue.ts authorize ${item.id} --by greg`);
      }
      console.log(
        `\n  The four whose 'waiting on' names him stay blocked after that, which is the point of the column.`,
      );
      return;
    }
    case "authorize": {
      /* **GREG'S COMMAND, AND THE FOLD ENFORCES THAT** — an `authorized` event
         from anyone else is recorded as a problem rather than a promotion. This
         check is here so the refusal is a sentence rather than a corrupt queue. */
      const id = idArg(parsed.words);
      const by = actor(parsed.flags);
      if (by !== "greg") fail("only Greg can authorise. Recording it as the Overseer would make the queue invalid.");
      const queue = view(dir);
      const item = [...queue.items, ...queue.settled].find((i) => i.id === id);
      if (item === undefined) fail(`no item ${id} in the queue`);
      write(
        dir,
        [{ ...envelope(by), kind: "authorized", id, revision: item.revision }],
        queue.version,
        `authorised ${id} at revision ${item.revision}`,
      );
      return;
    }
    case "add": {
      const by = actor(parsed.flags);
      const text = str(parsed.flags, "text");
      if (text === null || text.trim() === "") fail("--text is required: the idea, in the words you want kept");
      const queue = view(dir);
      const placement = placementFrom(parsed.flags);
      const event: IdeaEvent = {
        ...envelope(by, { commandId: str(parsed.flags, "command-id") }),
        kind: "added",
        id: mintId(),
        text,
        title: str(parsed.flags, "title"),
        metadata: { ...EMPTY_METADATA, ...metadataFrom(parsed.flags) },
        placement,
        needsGreg: parsed.flags.get("needs-greg") !== undefined,
      };
      /* Said out loud, because it is the one thing about this command that is
         not obvious: the Overseer adding an item does not authorise it. */
      const note = by === "overseer" ? " as a PROPOSAL — only Greg can authorise it" : "";
      write(dir, [event], queue.version, `queued ${event.id} at the ${placement.at}${note}`);
      return;
    }
    case "move": {
      const id = idArg(parsed.words);
      const by = actor(parsed.flags);
      const queue = view(dir);
      const placement = placementFrom(parsed.flags);
      write(dir, [{ ...envelope(by), kind: "moved", id, placement }], queue.version, `moved ${id} to the ${placement.at}`);
      return;
    }
    case "edit": {
      const id = idArg(parsed.words);
      const by = actor(parsed.flags);
      const queue = view(dir);
      const text = str(parsed.flags, "text");
      const title = str(parsed.flags, "title");
      const metadata = metadataPatch(parsed.flags);
      const needs = parsed.flags.get("needs-greg") !== undefined;
      const ready = parsed.flags.get("ready") !== undefined;
      if (needs && ready) fail("--needs-greg and --ready say opposite things");
      const event: IdeaEvent = {
        ...envelope(by),
        kind: "edited",
        id,
        ...(text === null ? {} : { text }),
        ...(title !== null ? { title } : parsed.flags.get("clear-title") !== undefined ? { title: null } : {}),
        ...(metadata === undefined ? {} : { metadata }),
        ...(needs ? { needsGreg: true } : ready ? { needsGreg: false } : {}),
      };
      /* An edit that names nothing would append a line saying "edited nothing",
         which is noise in a record whose value is that every line means
         something. Six keys is the bare envelope plus `kind` and `id`. */
      if (Object.keys(event).length <= 7) fail("nothing to change — name a field, or --clear-<field>");
      /* **A CONTENT EDIT BY ANYONE BUT GREG LAPSES HIS APPROVAL**, and saying so
         here is the difference between a surprise and a decision. */
      const lapses = by !== "greg" && (text !== null || title !== null || metadata !== undefined);
      write(dir, [event], queue.version, `edited ${id}${lapses ? " — this LAPSES Greg's authorisation" : ""}`);
      return;
    }
    case "dispatched": {
      const id = idArg(parsed.words);
      const by = actor(parsed.flags);
      const session = str(parsed.flags, "session");
      if (session === null || session === "") fail("--session is required: the tmux session it was dispatched as");
      const queue = view(dir);
      /* **REFUSES TO RECORD A DISPATCH THE GATE WOULD NOT HAVE ALLOWED**, and
         says so here so the message is a sentence rather than a rejected
         append. The fold refuses it too, and `appendEvents` will not write a
         batch that adds a problem — three layers, of which this is only the
         friendliest.

         **`--anyway` USED TO EXIST HERE AND HAS BEEN REMOVED.** It let somebody
         record a dispatch of an unauthorised item "to reconcile a launch that
         already happened", which is exactly the line that later reads as
         permission — GPT Sol's P1-3: *reconciliation should be a distinct,
         conspicuous event, not the normal transition with its guard disabled*.
         There is no such event yet, so for now the honest answer is that this
         command cannot record it. When dispatch is designed properly (stage 4,
         with the coordinator) reconciliation gets its own event kind. */
      const item = [...queue.items, ...queue.settled].find((i) => i.id === id);
      if (item !== undefined) {
        const why = whyNotDispatchable(queue, item);
        if (why !== null) {
          fail(
            `${id} is not dispatchable: ${why}.\n` +
              `  Recording it anyway is deliberately not possible: a dispatch line in this file reads as\n` +
              `  permission, and there is no reconciliation event yet. Fix the cause, or wait for stage 4.`,
          );
        }
      }
      write(
        dir,
        [{ ...envelope(by), kind: "dispatched", id, session, plan: str(parsed.flags, "plan") }],
        queue.version,
        `${id} dispatched as ${session}`,
      );
      return;
    }
    case "done": {
      const id = idArg(parsed.words);
      const by = actor(parsed.flags);
      const queue = view(dir);
      write(dir, [{ ...envelope(by), kind: "done", id }], queue.version, `${id} done`);
      return;
    }
    case "drop": {
      const id = idArg(parsed.words);
      const by = actor(parsed.flags);
      const queue = view(dir);
      write(dir, [{ ...envelope(by), kind: "dropped", id, why: str(parsed.flags, "why") }], queue.version, `${id} dropped`);
      return;
    }
    default:
      console.error(`✗ no such command: ${command}\n`);
      console.error(USAGE);
      process.exit(2);
  }
}

main();
