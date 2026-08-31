/**
 * **Turning a stream of realtime events into conversation turns.**
 *
 * A pure reducer, deliberately: no React, no network, no clock. Feed it the
 * events a live session emits, in whatever order they arrive, and it tells you
 * which exchanges are *finished* and what is in them. `useLiveConversation`
 * drives it; nothing else needs to know it exists.
 *
 * ## Why this is not just "remember the last question and the last answer"
 *
 * Because that is wrong, and it is wrong in a way that looks right for the
 * first few turns. GPT Sol's review of docs/plans/live-conversation-in-chat.md
 * took the first version of this plan apart on exactly this point, and the
 * sequence it gave is worth keeping:
 *
 * ```
 *   1. user item U1 is committed
 *   2. assistant response R1 starts
 *   3. reader interrupts, speaking U2
 *   4. R1's transcript arrives
 *   5. U2's transcription finishes
 *   6. R2 finishes
 *   7. U1's transcription FINALLY finishes        <- after everything
 * ```
 *
 * **The transcription of what you said arrives after the answer to it.** That
 * is not an edge case, it is the ordinary case whenever anybody talks over the
 * model. Anything keyed on arrival order persists an answer with no question,
 * or two questions in the wrong order, or a question attached to the wrong
 * reply — and every one of those is a corrupted transcript that the reader will
 * read back later and disbelieve.
 *
 * So order comes from **OpenAI's own item ids**, in the order the conversation
 * created them, and an exchange is emitted only when everything belonging to it
 * is terminal.
 *
 * ## What an exchange is
 *
 * One reader turn and everything the model did in reply to it — which may be
 * several responses, because a tool call ends one response and the answer
 * arrives in the next. `response.done` is therefore **not** the end of an
 * exchange; it is the end of a response. The exchange ends when a response
 * completes having asked for no further tools.
 *
 * ## Nothing the model produced is attributed by "the newest turn"
 *
 * **This was wrong once and it is the whole reason the file exists.** The first
 * version took order from item ids — correctly — and then wrote every
 * transcript delta, tool run and passage pointer onto `current`, meaning the
 * most recently created user item. Under the very sequence above that is a
 * different turn from the one being answered:
 *
 * ```
 *   U1 created            current = U1
 *   R1 starts             owned by U1
 *   reader interrupts, U2 created   current = U2      <- moves here
 *   R1's transcript arrives         written onto U2   <- wrong turn
 *   R1 completes          settles U1, whose answer is now empty
 * ```
 *
 * So U1 is stored with no answer and U2 with an answer to a question nobody
 * asked. GPT Sol found it in review on 2026-08-31, and found that the test
 * claiming to cover this ordering did not: it delivered R1's transcript
 * *before* creating U2, which is the one order that happens to work.
 *
 * Everything the model produces is therefore attributed by **its own
 * response id**, and a tool run or a pointer by **its call id**. `current` is
 * left for exactly one thing — deciding which turn a *new* response belongs to,
 * which is genuinely "the one the reader just took".
 *
 * ## What it deliberately does not do
 *
 * It does not talk to the server, and it does not decide when to write. It
 * reports "this exchange is complete"; the caller chooses what to do about it.
 * That split is what makes the ordering rules testable without a network, a
 * microphone, or a browser.
 */

/** Where a passage pointer came from — the `show_passage` tool. */
export interface ExchangePassage {
  blockIds: string[];
  why: string;
}

/** A server-side tool the model ran inside one exchange. */
export interface ExchangeTool {
  name: string;
  label: string;
  detail: string;
}

/** One reader turn and the whole reply to it, ready to be written down. */
export interface Exchange {
  /**
   * **Stable across retries, and minted from OpenAI's own ids** rather than
   * randomly: the same exchange rebuilt from the same events is the same
   * exchange.
   *
   * **The server does not see it and does not de-duplicate on it** — this
   * docstring said it did, which was never true. The write is guarded by
   * `expectedTailId` alone, which is the whole reason there is no exchange-id
   * column: a POST replayed after succeeding presents a tail the first attempt
   * has already moved. docs/project/live-conversation.md.
   */
  id: string;
  /** The reader's words. Empty when the transcription failed — see `question`. */
  question: string;
  /** The model's words. */
  answer: string;
  passages: ExchangePassage[];
  tools: ExchangeTool[];
  /**
   * The reader talked over this answer, so the text above may contain words
   * they never heard.
   *
   * OpenAI truncates the unplayed audio and does **not** hand back a corrected
   * transcript, so this cannot be fixed here — only declared. What must never
   * happen is that it is fed silently into the next turn as if it had been
   * heard. docs/plans/live-conversation-in-chat.md § 1c.
   */
  interrupted: boolean;
  /**
   * **Every conversation item this exchange was drawn from**, so the caller can
   * take its half-finished copy off the screen.
   *
   * The panel shows a live turn as it arrives — the reader's words, then the
   * companion's, appearing — and then the *same* exchange arrives again as two
   * stored rows in the thread. Without this the reader watches their question
   * duplicate itself the moment it is saved.
   *
   * It is here rather than worked out by the caller because the caller cannot:
   * an answer that used a tool spans several responses and therefore several
   * assistant items, and "the ones since the last emit" is exactly the
   * arrival-order reasoning this whole file exists to avoid.
   */
  itemIds: string[];
}

/** One reader turn being assembled. Internal. */
interface Pending {
  itemId: string;
  /** Conversation order, from the order items were created. */
  seq: number;
  question: string | null;
  /** Has the transcription landed (or failed)? A failure resolves to `""`. */
  questionSettled: boolean;
  /**
   * **What the model said, kept per response rather than as one string.**
   *
   * A tool-using answer spans two responses — "let me look that up", then the
   * answer — and the reader heard both, so both belong in the transcript. Each
   * response ends with a `done` frame carrying *its own* whole transcript, so a
   * single string assigned from that frame keeps whichever arrived last and
   * silently loses the other.
   *
   * Insertion order is response order — the slot is opened by `response.created`
   * rather than by the first transcript to arrive, because two responses can be
   * open at once and their delta streams are only loosely ordered.
   */
  said: Map<string, string>;
  passages: ExchangePassage[];
  tools: ExchangeTool[];
  interrupted: boolean;
  /** Every item id drawn into this turn — the reader's, and each answer's. */
  items: Set<string>;
  /** Response ids attributed to this turn, and whether each has finished. */
  responses: Map<string, boolean>;
  /** Has a response finished that asked for no further tool? */
  answerSettled: boolean;
  /** Already handed to the caller. */
  emitted: boolean;
}

export class ExchangeLedger {
  private readonly turns = new Map<string, Pending>();
  private order = 0;
  /**
   * The turn a **new response** belongs to — the most recently created user
   * item, which is genuinely "the one the reader just took".
   *
   * **It is not what anything else is attributed by.** See the header: writing
   * the model's own output onto this is the bug this file was rewritten to
   * remove.
   */
  private current: Pending | null = null;
  /**
   * Which turn each function call belongs to.
   *
   * A tool is run by the browser and answered whenever it finishes, which may
   * be after the reader has taken another turn — so the call id is the only
   * thing that still says which exchange the receipt belongs on.
   */
  private readonly calls = new Map<string, Pending>();

  /**
   * Feed one server event. Returns any exchanges that became complete, in
   * conversation order.
   *
   * **Returns rather than calls back**, so the caller owns sequencing. A
   * callback here would make "commit these serially, in order" the ledger's
   * problem, and it is not: the ledger knows the order, the caller knows what
   * writing means.
   */
  push(event: Record<string, unknown>): Exchange[] {
    const type = String(event.type ?? "");

    /* **A user item was created — this is what establishes order.** Not the
       transcription, which arrives much later, and not the first response.
       Every realtime conversation item carries an id and they are created in
       conversation order, so this is the only signal that is both early and
       correctly ordered. */
    if (type === "conversation.item.created" || type === "conversation.item.added") {
      const item = (event.item ?? {}) as { id?: string; role?: string; type?: string };
      if (item.role !== "user" || typeof item.id !== "string") return [];
      if (this.turns.has(item.id)) return [];
      const pending: Pending = {
        itemId: item.id,
        seq: this.order++,
        question: null,
        questionSettled: false,
        said: new Map(),
        passages: [],
        tools: [],
        interrupted: false,
        items: new Set([item.id]),
        responses: new Map(),
        answerSettled: false,
        emitted: false,
      };
      this.turns.set(item.id, pending);
      this.current = pending;
      return [];
    }

    /* The reader's words, arriving whenever they arrive — see the header. The
       item id is what puts them on the right turn, however late they are. */
    if (type === "conversation.item.input_audio_transcription.completed") {
      const turn = this.turns.get(String(event.item_id ?? ""));
      if (!turn) return [];
      turn.question = String(event.transcript ?? "").trim();
      turn.questionSettled = true;
      return this.harvest();
    }

    /* A failed transcription still settles the turn. Leaving it unsettled would
       strand the whole exchange — and with it every exchange after it, because
       they commit in order — on a question that is never coming. */
    if (type === "conversation.item.input_audio_transcription.failed") {
      const turn = this.turns.get(String(event.item_id ?? ""));
      if (!turn) return [];
      turn.question = "";
      turn.questionSettled = true;
      return this.harvest();
    }

    if (type === "response.created") {
      const id = String((event.response as { id?: unknown } | undefined)?.id ?? "");
      /* Attributed to the turn that was most recently created. A response with
         no user turn before it — the model speaking first — has nowhere to go
         and is dropped rather than inventing a turn to hold it. */
      if (id && this.current) {
        this.current.responses.set(id, false);
        /* **The slot is opened here, so `said` is ordered by when each response
           *began* rather than by whose transcript arrived first.** Two responses
           can be open at once and their delta streams are only loosely ordered,
           so insertion-on-first-transcript could store the second response's
           words before the first's. No supported tool flow produces that today
           — but the comment on `said` claims spoken order, and a claim that
           rests on an ordering nobody promises is the kind this file exists to
           remove. GPT Sol, second review. */
        if (!this.current.said.has(id)) this.current.said.set(id, "");
      }
      return [];
    }

    if (type === "response.output_audio_transcript.delta") {
      /* **The turn this response belongs to, not the newest one.** See the
         header: the reader can interrupt, which creates a new user item, and
         the interrupted answer's own transcript is still arriving. */
      const turn = this.answering(event);
      if (!turn) return [];
      const rid = String(event.response_id ?? "");
      turn.said.set(rid, (turn.said.get(rid) ?? "") + String(event.delta ?? ""));
      /* The assistant item this answer is being written into. Recorded on the
         delta as well as on the `done`, because a turn the reader hangs up in
         the middle of has deltas and no `done` — and its half-line is exactly
         the one that would otherwise be left on screen beside the stored copy. */
      if (typeof event.item_id === "string") turn.items.add(event.item_id);
      return [];
    }

    if (type === "response.output_audio_transcript.done") {
      const turn = this.answering(event);
      if (!turn) return [];
      if (typeof event.item_id === "string") turn.items.add(event.item_id);
      /* The whole transcript, replacing the deltas **of this response only** —
         the deltas are a preview of exactly this string, so trusting the final
         one means a dropped delta cannot leave a hole; and keying it by
         response means the second half of a tool-using answer cannot erase the
         first. */
      turn.said.set(String(event.response_id ?? ""), String(event.transcript ?? ""));
      return [];
    }

    /* **A function call, and which turn it belongs to.** Recorded here rather
       than when the browser answers it: by then the reader may have taken
       another turn, and a receipt filed against the wrong exchange is a claim
       the reader never saw made. */
    if (type === "response.function_call_arguments.done") {
      const turn = this.answering(event);
      const callId = String(event.call_id ?? "");
      if (turn && callId) this.calls.set(callId, turn);
      return [];
    }

    /* The reader started talking. Whether that is an interruption depends on
       whether the model was mid-answer, which the caller knows and we do not —
       so `interrupt()` below is called explicitly rather than inferred here. */

    if (type === "response.done") {
      const response = (event.response ?? {}) as {
        id?: unknown;
        status?: unknown;
        output?: unknown[];
      };
      const id = String(response.id ?? "");
      const turn = this.turnForResponse(id) ?? this.current;
      if (!turn) return [];
      turn.responses.set(id, true);

      /* **A response that asked for a tool is not the end of the answer.** The
         tool result goes back and the model replies in a *new* response, so
         treating `response.done` as the end of the exchange would write down
         the half of the answer that says "let me look that up" and throw away
         the half that answers the question. */
      const calls = (response.output ?? []).filter(
        (o) => (o as { type?: string }).type === "function_call",
      );
      /* The same registration the streaming event above does. It is a safety
         net rather than the path — every call observed so far has arrived as
         `response.function_call_arguments.done` first — and `Map.set` with the
         same turn twice is free. */
      for (const call of calls) {
        const id = String((call as { call_id?: unknown }).call_id ?? "");
        if (id) this.calls.set(id, turn);
      }
      const wantsMore = calls.length > 0;
      if (!wantsMore) turn.answerSettled = true;
      return this.harvest();
    }

    return [];
  }

  /**
   * A tool finished. **Filed against the turn that asked for it**, by call id.
   *
   * The browser runs these, and a slow one finishes after the reader has moved
   * on — so `current` is the wrong answer whenever it matters. `call_id` is the
   * only thing that still knows, which is why `push` records it when the call
   * is *made* rather than when it is answered.
   */
  tool(callId: string, run: ExchangeTool): void {
    (this.calls.get(callId) ?? this.current)?.tools.push(run);
  }

  /** The model pointed at a passage. `show_passage`, answered in the browser. */
  passage(callId: string, passage: ExchangePassage): void {
    (this.calls.get(callId) ?? this.current)?.passages.push(passage);
  }

  /**
   * The reader talked over the answer being assembled.
   *
   * Marks the turn rather than editing its text, because the text cannot be
   * corrected: the server truncates the audio and keeps the transcript whole.
   */
  interrupt(): void {
    if (this.current && !this.current.answerSettled) this.current.interrupted = true;
  }

  /**
   * Everything still unfinished, as exchanges, for a session that is ending.
   *
   * A reader who hangs up mid-answer should still keep what was said. So the
   * unsettled halves are taken as they stand and marked `interrupted`, which is
   * exactly what they are — and which is honest in the one way that matters,
   * since the alternative is silently discarding a turn the reader watched
   * happen.
   *
   * A turn with nothing on either side is dropped: an item created by a cough
   * with no transcript and no reply is not a conversation turn.
   */
  drain(): Exchange[] {
    const out: Exchange[] = [];
    for (const turn of [...this.turns.values()].sort((a, b) => a.seq - b.seq)) {
      if (turn.emitted) continue;
      const question = turn.question ?? "";
      if (question === "" && spoken(turn) === "") continue;
      turn.emitted = true;
      out.push(asExchange(turn, !turn.answerSettled || turn.interrupted));
    }
    return out;
  }

  /**
   * How many turns are still waiting for something terminal.
   *
   * The hang-up grace window reads this, and it is what makes that window end
   * early instead of always costing its full length: a reader who stops after
   * a finished answer waits for nothing. What it is waiting *for* is usually
   * the reader's own transcription, which arrives after the answer to it — so
   * closing the channel the instant Stop is pressed loses the question and
   * keeps the answer. GPT Sol's finding 7.
   */
  pending(): number {
    let n = 0;
    for (const turn of this.turns.values()) {
      if (!turn.emitted && (!turn.questionSettled || !turn.answerSettled)) n++;
    }
    return n;
  }

  /**
   * The turn a piece of model output belongs to — **from its own response id**.
   *
   * Falls back to `current` only when the event carries no response id we know,
   * which is the shape of an older or a differently-spelled event. That
   * fallback is the old behaviour and is wrong in exactly the interruption case
   * the header describes; it is kept because "attributed to something" beats
   * "silently dropped" for a stream we do not control, and it is narrow enough
   * that a change in the event shape shows up as the old bug rather than as
   * nothing at all.
   */
  private answering(event: Record<string, unknown>): Pending | undefined {
    return this.turnForResponse(String(event.response_id ?? "")) ?? this.current ?? undefined;
  }

  private turnForResponse(id: string): Pending | undefined {
    if (!id) return undefined;
    for (const turn of this.turns.values()) if (turn.responses.has(id)) return turn;
    return undefined;
  }

  /**
   * Emit every complete exchange that has no incomplete exchange before it.
   *
   * **The ordering rule, and the reason it is a rule rather than a sort.** Turn
   * 2 can be complete while turn 1 is still waiting for its transcription (the
   * header's sequence is exactly that). Emitting turn 2 first would write the
   * conversation down in the wrong order, and the store appends — there is no
   * inserting turn 1 in front of it afterwards. So a finished turn waits behind
   * an unfinished one.
   */
  private harvest(): Exchange[] {
    const out: Exchange[] = [];
    for (const turn of [...this.turns.values()].sort((a, b) => a.seq - b.seq)) {
      if (turn.emitted) continue;
      if (!turn.questionSettled || !turn.answerSettled) break;
      turn.emitted = true;
      out.push(asExchange(turn, turn.interrupted));
    }
    return out;
  }
}

/**
 * Everything the model said in this turn, in the order it said it.
 *
 * Joined with a space rather than concatenated: two responses are two spoken
 * runs, and `"Let me check."` followed immediately by `"No, he never uses it."`
 * reads as one mangled sentence in the reader's transcript. Blank runs are
 * dropped — a response that only asked for a tool contributes no words.
 */
function spoken(turn: Pending): string {
  return [...turn.said.values()].map((t) => t.trim()).filter(Boolean).join(" ");
}

function asExchange(turn: Pending, interrupted: boolean): Exchange {
  return {
    /* From the item id, so the same exchange is always the same id. Prefixed
       because a bare OpenAI id anywhere near our own would look like ours to
       the next person reading it. Not sent anywhere — see the field. */
    id: `live-${turn.itemId}`,
    question: turn.question ?? "",
    answer: spoken(turn),
    passages: turn.passages,
    tools: turn.tools,
    interrupted,
    itemIds: [...turn.items],
  };
}
