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
   * randomly, so that a POST replayed after a dropped connection is recognised
   * as the same exchange rather than appended twice. The server de-duplicates
   * on this.
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
}

/** One reader turn being assembled. Internal. */
interface Pending {
  itemId: string;
  /** Conversation order, from the order items were created. */
  seq: number;
  question: string | null;
  /** Has the transcription landed (or failed)? A failure resolves to `""`. */
  questionSettled: boolean;
  answer: string;
  passages: ExchangePassage[];
  tools: ExchangeTool[];
  interrupted: boolean;
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
  /** The turn new responses belong to — the most recently created user item. */
  private current: Pending | null = null;

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
        answer: "",
        passages: [],
        tools: [],
        interrupted: false,
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
      if (id && this.current) this.current.responses.set(id, false);
      return [];
    }

    if (type === "response.output_audio_transcript.delta") {
      if (this.current) this.current.answer += String(event.delta ?? "");
      return [];
    }

    if (type === "response.output_audio_transcript.done") {
      /* The whole transcript, replacing the deltas — the deltas are a preview
         of exactly this string, and trusting the final one means a dropped
         delta cannot leave a hole in what gets stored. */
      if (this.current) this.current.answer = String(event.transcript ?? "");
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
      const wantsMore = (response.output ?? []).some(
        (o) => (o as { type?: string }).type === "function_call",
      );
      if (!wantsMore) turn.answerSettled = true;
      return this.harvest();
    }

    return [];
  }

  /** A tool ran inside the current turn. Called by the hook, which runs them. */
  tool(run: ExchangeTool): void {
    this.current?.tools.push(run);
  }

  /** The model pointed at a passage. `show_passage`, answered in the browser. */
  passage(passage: ExchangePassage): void {
    this.current?.passages.push(passage);
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
      if (question === "" && turn.answer === "") continue;
      turn.emitted = true;
      out.push(asExchange(turn, !turn.answerSettled || turn.interrupted));
    }
    return out;
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

function asExchange(turn: Pending, interrupted: boolean): Exchange {
  return {
    /* From the item id, so a replayed POST is recognisably the same exchange.
       Prefixed because a bare OpenAI id in our own column would look like ours
       to the next person reading the table. */
    id: `live-${turn.itemId}`,
    question: turn.question ?? "",
    answer: turn.answer,
    passages: turn.passages,
    tools: turn.tools,
    interrupted,
  };
}
