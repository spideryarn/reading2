/**
 * **Turning GPT-Live's transcript fragments into chat rows.**
 *
 * A pure reducer: no React, no network, no clock. `useGptLive` feeds it every
 * transcript fragment and every tool receipt, and it says which exchanges are
 * ready to be written down. It is the GPT-Live counterpart of `../exchanges.ts`
 * and shares nothing with it but the output shape, because the two wires share
 * nothing: Realtime gives item ids and turn boundaries, and GPT-Live gives
 * neither. docs/plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md
 * § Turning fragments into chat rows.
 *
 * ## What arrives
 *
 * `session.input_transcript.delta` and `session.output_transcript.delta`: a
 * 200 ms window on the session timeline (`start_ms`, `end_ms`), a few
 * characters, an `event_id`. No item id, no turn id, no "done". Both sides can
 * be speaking at once, and one side's fragments can arrive after the other's
 * later ones.
 *
 * ## What the rows promise: chronology, not ownership
 *
 * Nothing on the wire says which question a stretch of speech answers, so
 * nothing here claims to know. The rows read back in the order things were
 * said and no word is dropped. That is all.
 *
 * ## The rules
 *
 * **Order comes from the timeline, never from arrival.** Fragments are
 * de-duplicated by event id and sorted by where they start. Until an exchange
 * is frozen, everything about it is recomputed from the sorted fragments on
 * every push, so a reader fragment that arrives late (the spike shows input
 * fragments trailing output ones) lands where it was said and moves whatever
 * it has to.
 *
 * **A reader segment** is a run of reader fragments. A new one begins only
 * when the reader paused for more than `READER_PAUSE_MS` *and* the companion
 * began speaking in that pause. Both conditions, because fragments are sparse
 * (the spike has 600 ms between two words of one sentence), and because two
 * people talking at once would otherwise alternate word by word.
 *
 * **A companion segment** is all the companion's fragments from one reader
 * segment's start to the next one's. So a reader segment always splits the
 * companion's speech at the moment the reader began, however short it is.
 *
 * **An exchange** is one reader segment and the companion segment after it.
 * Companion speech before any reader segment is an exchange with an empty
 * question. "mm-hm" in the middle of an answer is therefore a short question
 * whose answer is the rest of what the companion was saying: an odd-looking
 * row, and nothing lost. (The first draft of the plan dropped short
 * interjections, and GPT Sol's review pointed out that "Don't continue" is
 * two words. F1.)
 *
 * **`interrupted`** is set on an exchange when the reader segment that ended
 * it has more than `BACKCHANNEL_WORDS` words and began less than
 * `INTERRUPT_GAP_MS` after the companion's last fragment ended, or over it. A
 * shorter interjection splits the rows and leaves the flag alone.
 *
 * **An exchange is emitted when it can no longer change, and not before.**
 * That means the *next* reader segment has finished: the companion has been
 * heard `READER_PAUSE_MS` past its last word, or a further reader segment has
 * begun. Or the call is closing. **Never on silence, and never because the
 * backend finished** (F2): the backend's answer is spoken seconds after the
 * backend completes, and silence cannot tell "finished" from "not started".
 * Waiting for the next reader segment to finish, and not only to begin, is
 * what lets `interrupted` count its words, and it means the companion's
 * fragments have passed the boundary before the boundary is fixed.
 *
 * **Emitted means frozen.** An exchange has a sequence number, is returned
 * exactly once, and its fragments are never looked at again. A fragment that
 * arrives afterwards with a time inside frozen ground is moved up to the edge
 * of it, so it joins the first exchange that is still open, or starts a new
 * one. After `closing()` that edge is the end of everything heard, so a late
 * companion fragment becomes an exchange with an empty question.
 *
 * **Receipts** (tool runs and passages) are held per delegation. When the
 * delegation's final backend response completes they are pinned to the latest
 * point heard on the timeline, and go out on the exchange that contains that
 * point. A reader who speaks between the backend finishing and the voice
 * answering therefore leaves the receipts one exchange before the spoken
 * answer; the plan accepts that and so does this (F3). Receipts whose
 * delegation never finished go on the last exchange at closing. If nothing was
 * ever said there is no exchange to put them on, none is invented, and
 * `closing()` returns them as `unattached` so the caller can see what was not
 * stored.
 *
 * ## Text
 *
 * Deltas carry their own leading spaces (" 198" then "7."), so a segment's
 * text is its deltas concatenated, runs of whitespace collapsed, trimmed. A
 * whitespace-only delta is not a fragment: it cannot start a segment, split
 * one or settle anything. Its space is kept and put in front of that
 * speaker's next delta, which is what makes " " then "1987" read " 1987".
 *
 * ## What it does not decide
 *
 * Whether a hang-up cut an answer short. `closing()` does not set
 * `interrupted` on the last exchange, because nothing on this wire says
 * whether the companion had finished.
 */
import type { Exchange, ExchangePassage, ExchangeTool } from "../exchanges.js";
import type { LiveLine } from "../useLiveConversation.js";

/** Who was speaking. The same two names the live transcript uses. */
export type Speaker = LiveLine["role"];

/** A line as this reducer knows it: everything in `LiveLine` but which call it was. */
export type SegmentLine = Omit<LiveLine, "session">;

/** How long the reader must pause, with the companion speaking in the pause, to begin a new segment. */
export const READER_PAUSE_MS = 1_000;
/** The reader began this soon after the companion's last fragment (or over it): the companion was cut into. */
export const INTERRUPT_GAP_MS = 700;
/** An interjection of this many words or fewer does not mark the answer before it interrupted. */
export const BACKCHANNEL_WORDS = 4;

/** One transcript delta, as the wire sends it. */
export interface TranscriptFragment {
  role: Speaker;
  eventId: string;
  startMs: number;
  endMs: number;
  delta: string;
}

/** Everything the reducer is told. */
export type SegmentEvent =
  | ({ type: "fragment" } & TranscriptFragment)
  /** A tool finished inside a delegation. Held until that delegation's final. */
  | { type: "tool"; delegationId: string; tool: ExchangeTool }
  /** `show_passage` ran inside a delegation. Held the same way. */
  | { type: "passage"; delegationId: string; passage: ExchangePassage }
  /**
   * The delegation's final backend response completed. Its held receipts, and
   * any handed over here, are pinned to this point on the timeline.
   */
  | { type: "delegation-final"; delegationId: string; tools?: ExchangeTool[]; passages?: ExchangePassage[] };

/** A run of one speaker's fragments. The record the exchanges are projected from. */
export interface SpeakerSegment {
  /** `seg-<n>`. The id of the matching line in `lines()`. */
  id: string;
  role: Speaker;
  startMs: number;
  endMs: number;
  text: string;
  /** Part of an emitted exchange, so it will never change again. */
  frozen: boolean;
}

/** One exchange, ready for `speak`. The Realtime ledger's shape plus a sequence number. */
export interface SpokenExchange extends Exchange {
  /** 0, 1, 2… in the order emitted, which is the order spoken. Never reused. */
  seq: number;
}

export interface Receipts {
  tools: ExchangeTool[];
  passages: ExchangePassage[];
}

export interface Closing {
  /** Everything not yet emitted, in order. */
  exchanges: SpokenExchange[];
  /** Receipts with no exchange to go on, because nothing was said. Not stored anywhere. */
  unattached: Receipts;
}

interface Fragment {
  role: Speaker;
  startMs: number;
  /** Where it sits: `startMs`, or the edge of frozen ground if it arrived for a frozen exchange. */
  at: number;
  end: number;
  text: string;
  /** Arrival order, the last tie-break. */
  arrival: number;
  /** The line number of the segment it was last part of, so a line keeps its id as it grows. */
  line: number | null;
}

/** An exchange still being assembled: recomputed from the open fragments on every push. */
interface Draft {
  reader: Fragment[];
  companion: Fragment[];
  readerLine: number | null;
  companionLine: number | null;
}

interface Pinned extends Receipts {
  at: number;
}

export class Segmenter {
  private readonly seen = new Set<string>();
  private open: Fragment[] = [];
  private readonly frozen: SpeakerSegment[] = [];
  /** Which emitted exchange each frozen segment went out in. For `lines()`. */
  private readonly frozenIn = new Map<string, number>();
  /** Nothing may be placed before this: the edge of what has been emitted. */
  private floor = 0;
  /** The furthest point heard, for `closing()` to move the floor to. */
  private heardTo = 0;
  private arrivals = 0;
  private emitted = 0;
  private lineIds = 0;
  private readonly space: Record<Speaker, boolean> = { reader: false, companion: false };
  private readonly held = new Map<string, Receipts>();
  private pinned: Pinned[] = [];

  /** Feed one event. Returns the exchanges that can no longer change, in order. */
  push(event: SegmentEvent): SpokenExchange[] {
    switch (event.type) {
      case "fragment":
        if (!this.add(event)) return [];
        return this.settle();
      case "tool":
        this.holding(event.delegationId).tools.push(event.tool);
        return [];
      case "passage":
        this.holding(event.delegationId).passages.push(event.passage);
        return [];
      case "delegation-final": {
        const receipts = this.holding(event.delegationId);
        this.held.delete(event.delegationId);
        receipts.tools.push(...(event.tools ?? []));
        receipts.passages.push(...(event.passages ?? []));
        if (receipts.tools.length === 0 && receipts.passages.length === 0) return [];
        /* Pinned to a point, not to "the open exchange": the exchanges are
           recomputed until they freeze, and a point stays where it is. */
        const at = this.open.reduce((latest, f) => Math.max(latest, f.at), this.floor);
        this.pinned.push({ at, ...receipts });
        return [];
      }
      default:
        return unreachable(event);
    }
  }

  /**
   * The call is ending: everything still open, as exchanges.
   *
   * Safe to call again. A fragment that arrives after it starts a new exchange,
   * which the next `closing()` returns.
   */
  closing(): Closing {
    const drafts = this.project();
    const exchanges: SpokenExchange[] = [];
    const leftover: Receipts = { tools: [], passages: [] };
    for (const receipts of this.held.values()) merge(leftover, receipts);
    this.held.clear();
    drafts.forEach((draft, i) => {
      const next = drafts[i + 1];
      exchanges.push(this.freeze(draft, next, next ? [] : [leftover]));
    });
    this.floor = Math.max(this.floor, this.heardTo);
    if (drafts.length > 0) return { exchanges, unattached: { tools: [], passages: [] } };
    for (const pin of this.pinned) merge(leftover, pin);
    this.pinned = [];
    return { exchanges, unattached: leftover };
  }

  /** Every speaker segment of the call, frozen and open, in spoken order. */
  segments(): SpeakerSegment[] {
    const out = [...this.frozen];
    for (const draft of this.project()) out.push(...segmentsOf(draft, false));
    return out;
  }

  /**
   * The live transcript: one line per segment.
   *
   * A line is `done` when its segment is frozen, or when its speaker has begun
   * a later segment. The caller takes a line off the screen when the exchange
   * naming it in `itemIds` has been written.
   *
   * `exchange` and `seq` are what the thread groups and orders by
   * (../tail.ts): the exchange the segment is, or will be, emitted in. For a
   * frozen segment that is settled. For an open one it is the number its draft
   * gets if the open drafts freeze as they now stand, so it can move while the
   * words are still arriving — as a Realtime line's does when the ledger first
   * places it. `session` is the hook's to add; this class knows one call.
   */
  lines(): SegmentLine[] {
    const owner = new Map(this.frozenIn);
    this.project().forEach((draft, i) => {
      for (const segment of segmentsOf(draft, false)) owner.set(segment.id, this.emitted + i);
    });
    const all = this.segments();
    return all.map((segment, i) => {
      const seq = owner.get(segment.id) ?? Number.POSITIVE_INFINITY;
      return {
        id: segment.id,
        role: segment.role,
        text: segment.text,
        done: segment.frozen || all.slice(i + 1).some((later) => later.role === segment.role),
        exchange: Number.isFinite(seq) ? `gpt-live-${seq}` : segment.id,
        seq,
      };
    });
  }

  /** Record a fragment. False when it changes nothing: a repeat, or only whitespace. */
  private add(f: TranscriptFragment): boolean {
    if (this.seen.has(f.eventId)) return false;
    this.seen.add(f.eventId);
    if (f.delta.trim() === "") {
      if (f.delta !== "") this.space[f.role] = true;
      return false;
    }
    const at = Math.max(f.startMs, this.floor);
    const end = Math.max(f.endMs, at);
    this.open.push({
      role: f.role,
      startMs: f.startMs,
      at,
      end,
      text: (this.space[f.role] ? " " : "") + f.delta,
      arrival: this.arrivals++,
      line: null,
    });
    this.space[f.role] = false;
    this.heardTo = Math.max(this.heardTo, end);
    return true;
  }

  private holding(delegationId: string): Receipts {
    let receipts = this.held.get(delegationId);
    if (!receipts) {
      receipts = { tools: [], passages: [] };
      this.held.set(delegationId, receipts);
    }
    return receipts;
  }

  /** Freeze and return every exchange that can no longer change. */
  private settle(): SpokenExchange[] {
    const out: SpokenExchange[] = [];
    for (;;) {
      const [first, next, further] = this.project();
      if (!first || !next) return out;
      /* **The whole rule for writing.** The next reader segment has finished:
         a further one has begun, or the companion has been heard well past its
         last word. Nothing else freezes an exchange while the call is open. */
      const nextEnds = endOf(next.reader);
      const finished =
        further !== undefined ||
        this.open.some((f) => f.role === "companion" && f.at >= nextEnds + READER_PAUSE_MS);
      if (!finished) return out;
      out.push(this.freeze(first, next, []));
    }
  }

  /**
   * Emit one draft and forget its fragments.
   *
   * `next` is the draft after it, whose reader segment is what ended this one.
   * Without a `next` the call is closing and this is the last exchange.
   */
  private freeze(draft: Draft, next: Draft | undefined, extra: Receipts[]): SpokenExchange {
    const boundary = next?.reader[0]?.at ?? Number.POSITIVE_INFINITY;
    const receipts: Receipts = { tools: [], passages: [] };
    this.pinned = this.pinned.filter((pin) => {
      if (pin.at >= boundary) return true;
      merge(receipts, pin);
      return false;
    });
    for (const more of extra) merge(receipts, more);

    const segments = segmentsOf(draft, true);
    this.frozen.push(...segments);
    const gone = new Set<Fragment>([...draft.reader, ...draft.companion]);
    this.open = this.open.filter((f) => !gone.has(f));
    if (Number.isFinite(boundary)) this.floor = Math.max(this.floor, boundary);

    const seq = this.emitted++;
    for (const segment of segments) this.frozenIn.set(segment.id, seq);
    return {
      seq,
      id: `gpt-live-${seq}`,
      question: textOf(draft.reader),
      answer: textOf(draft.companion),
      passages: receipts.passages,
      tools: receipts.tools,
      interrupted: next !== undefined && cutInto(draft, next),
      itemIds: segments.map((segment) => segment.id),
    };
  }

  /**
   * The open fragments as drafts, in spoken order.
   *
   * A pure function of the open fragments, apart from handing out line ids:
   * the same fragments in any arrival order give the same drafts.
   */
  private project(): Draft[] {
    const sorted = [...this.open].sort(
      (a, b) => a.at - b.at || a.startMs - b.startMs || a.arrival - b.arrival,
    );
    const companions = sorted.filter((f) => f.role === "companion");
    /* Companion speech before any reader segment. Kept only if there is some. */
    const opening: Draft = { reader: [], companion: [], readerLine: null, companionLine: null };
    const drafts: Draft[] = [];
    let ends = 0;
    for (const f of sorted) {
      if (f.role !== "reader") continue;
      const current = drafts.at(-1);
      const since = ends;
      const paused =
        f.at - since > READER_PAUSE_MS && companions.some((c) => c.at >= since && c.at < f.at);
      if (!current || paused) {
        drafts.push({ reader: [f], companion: [], readerLine: null, companionLine: null });
        ends = f.end;
      } else {
        current.reader.push(f);
        ends = Math.max(ends, f.end);
      }
    }
    for (const c of companions) {
      let owner = opening;
      for (const draft of drafts) {
        const starts = draft.reader[0]?.at ?? 0;
        if (starts <= c.at) owner = draft;
      }
      owner.companion.push(c);
    }
    const all = opening.companion.length > 0 ? [opening, ...drafts] : drafts;

    /* Line ids. A segment keeps the lowest id any of its fragments already
       carries, so a line stays the same line as it grows. When a late fragment
       splits a segment in two, the earlier half keeps the id and the later
       half gets a new one. */
    const used = new Set<number>();
    const label = (fragments: Fragment[]): number | null => {
      if (fragments.length === 0) return null;
      const carried = fragments
        .map((f) => f.line)
        .filter((n): n is number => n !== null && !used.has(n));
      const id = carried.length > 0 ? Math.min(...carried) : this.lineIds++;
      used.add(id);
      for (const f of fragments) f.line = id;
      return id;
    };
    for (const draft of all) {
      draft.readerLine = label(draft.reader);
      draft.companionLine = label(draft.companion);
    }
    return all;
  }
}

/** Did the reader segment that begins `next` cut into `draft`'s answer with a real sentence? */
function cutInto(draft: Draft, next: Draft): boolean {
  const first = next.reader[0];
  if (!first || draft.companion.length === 0) return false;
  if (first.at - endOf(draft.companion) >= INTERRUPT_GAP_MS) return false;
  return wordsIn(textOf(next.reader)) > BACKCHANNEL_WORDS;
}

function segmentsOf(draft: Draft, frozen: boolean): SpeakerSegment[] {
  const out: SpeakerSegment[] = [];
  const sides: [Speaker, Fragment[], number | null][] = [
    ["reader", draft.reader, draft.readerLine],
    ["companion", draft.companion, draft.companionLine],
  ];
  for (const [role, fragments, line] of sides) {
    const first = fragments[0];
    if (!first || line === null) continue;
    out.push({
      id: `seg-${line}`,
      role,
      startMs: first.at,
      endMs: endOf(fragments),
      text: textOf(fragments),
      frozen,
    });
  }
  return out;
}

function endOf(fragments: Fragment[]): number {
  return fragments.reduce((latest, f) => Math.max(latest, f.end), 0);
}

function textOf(fragments: Fragment[]): string {
  return fragments
    .map((f) => f.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function wordsIn(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function merge(into: Receipts, from: Receipts): void {
  into.tools.push(...from.tools);
  into.passages.push(...from.passages);
}

function unreachable(value: never): never {
  throw new Error(`Unhandled segment event: ${JSON.stringify(value)}`);
}
