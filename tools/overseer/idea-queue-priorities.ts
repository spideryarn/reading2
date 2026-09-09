/**
 * SETTING A LOT OF PRIORITIES AT ONCE, from a file somebody can read first.
 *
 * Greg, 2026-09-09: *"You can put all the Spideryarn product ideas as
 * low-priority, so that if you run out of other stuff you can get to them, but
 * focus on tooling for Overseer first, then web dashboard, and Spideryarn
 * product stuff at the bottom."*
 *
 * That is an ordering over **categories**, and the queue stores a number per
 * **item**. Somebody has to do the translation, and the two places it could
 * live are a table compiled into the CLI or a file passed to it. This module is
 * the second, for one reason: **the mapping is the thing being reviewed.**
 * Greg's banding is a decision he should be able to read back before it lands
 * on sixteen rows of his own authorisation record, and a `const` in a script is
 * not something anybody reads twice.
 *
 * So the file is one item per line, comments allowed:
 *
 *     # Overseer tooling first
 *     qi-a3k9mq2p 0.85   # the queue CLI
 *     qi-b7x2ndhr 0.60   # dashboard
 *     qi-c9w4ktzz 0.15   # Spideryarn product cluster A
 *
 * **A file that is half understood is refused whole** — the same rule
 * [`idea-queue.ts`](./idea-queue.ts)'s fold keeps, and for the same reason. A
 * partial application of an ordering looks exactly like the ordering somebody
 * wrote, and there is nothing on the page afterwards to say which half arrived.
 *
 * Nothing here writes. `parsePriorityFile` reads text, `planPriorities` compares
 * a wish against a folded view, and the CLI turns the plan into events — so the
 * dry run and the apply cannot drift, because they are the same function.
 */
import { ID_RULE, isPriority, type IdeaItem, type QueueView } from "./idea-queue.js";

/** One line of the file: this item, at this number. */
export type PriorityWish = {
  readonly id: string;
  readonly priority: number;
};

export type PriorityFileRead = { readonly ok: true; readonly wanted: PriorityWish[] } | { readonly ok: false; readonly why: string };

/**
 * The file, or the first reason it could not be read.
 *
 * **Strict, and it stops at the first bad line rather than collecting them.**
 * The output of this is a refusal a person acts on by fixing the file and
 * running it again, so a list of every fault is not worth the shape it would
 * need; naming the line number and what was wrong with it is.
 *
 * A duplicate id is a refusal rather than a last-one-wins, because two lines
 * for one item is somebody having edited the file twice and meant only one of
 * them — and there is no way to tell which from here.
 */
export function parsePriorityFile(text: string): PriorityFileRead {
  const wanted: PriorityWish[] = [];
  const seen = new Set<string>();
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    /* A `#` anywhere ends the line, so a reason can sit beside the number.
       Nothing here needs a `#` in a value: ids and numbers have no use for one. */
    const hash = raw.indexOf("#");
    const body = (hash === -1 ? raw : raw.slice(0, hash)).trim();
    if (body === "") continue;
    const at = `line ${index + 1}`;
    const parts = body.split(/\s+/);
    if (parts.length !== 2) {
      return { ok: false, why: `${at} is not '<id> <priority>': ${JSON.stringify(body)}` };
    }
    const [id, figure] = parts as [string, string];
    if (!ID_RULE.test(id)) return { ok: false, why: `${at}: ${JSON.stringify(id)} is not a queue id` };
    /* `Number("")` is 0 and `Number(" ")` is 0 — the trap this module's sibling
       already fell into once, with an empty version string parsing as *the
       queue is empty*. `body` is split on whitespace so neither can reach here,
       and `isPriority` refuses a NaN in any case. */
    const priority = Number(figure);
    if (!isPriority(priority) || priority === null) {
      return { ok: false, why: `${at}: ${JSON.stringify(figure)} is not a priority — it must be a number from 0 to 1` };
    }
    if (seen.has(id)) return { ok: false, why: `${at}: ${id} is named twice, and only one of those was meant` };
    seen.add(id);
    wanted.push({ id, priority });
  }
  if (wanted.length === 0) return { ok: false, why: "that file names no items — nothing to do, which is probably not what was meant" };
  return { ok: true, wanted };
}

/** What applying a file would do, and what it would leave alone. */
export type PriorityPlan = {
  /** The writes. One `prioritized` event each, and nothing else appends. */
  readonly changes: readonly { readonly id: string; readonly from: number | null; readonly to: number; readonly needsGreg: boolean }[];
  /** Named, and already at that number. **No event**: a line that changes nothing is noise in a record whose value is that every line means something. */
  readonly unchanged: readonly { readonly id: string; readonly priority: number }[];
  /** Named by the file and not in the live queue — a typo, or an item that has since been done or dropped. */
  readonly absent: readonly string[];
  /** In the queue and not named by the file, so it keeps whatever priority it had. */
  readonly unnamed: readonly string[];
};

/**
 * Compare a wish against the queue as it stands.
 *
 * **All four buckets are reported, and the last two are the point.** A bulk
 * write that says only *"12 changed"* cannot be reviewed: the interesting
 * questions are which ids in the file the queue has never heard of, and which
 * queued items the file forgot — and both of those are silent in a diff that
 * only counts writes.
 *
 * `needsGreg` rides along on each change because Greg's banding leaves those
 * *"unchanged in priority"*, and whether a given file honours that is a fact
 * about the file. It is shown rather than enforced: a rule hidden in here would
 * quietly drop lines somebody wrote on purpose.
 */
export function planPriorities(view: QueueView, wanted: readonly PriorityWish[]): PriorityPlan {
  const live = new Map<string, IdeaItem>(view.items.map((item) => [item.id, item]));
  const changes: { id: string; from: number | null; to: number; needsGreg: boolean }[] = [];
  const unchanged: { id: string; priority: number }[] = [];
  const absent: string[] = [];
  const named = new Set<string>();
  for (const wish of wanted) {
    const item = live.get(wish.id);
    if (item === undefined) {
      absent.push(wish.id);
      continue;
    }
    named.add(wish.id);
    if (item.priority === wish.priority) {
      unchanged.push({ id: wish.id, priority: wish.priority });
      continue;
    }
    changes.push({ id: wish.id, from: item.priority, to: wish.priority, needsGreg: item.needsGreg });
  }
  return { changes, unchanged, absent, unnamed: view.items.filter((i) => !named.has(i.id)).map((i) => i.id) };
}
