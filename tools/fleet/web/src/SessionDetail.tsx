/**
 * One session, at length — and the only place on this page that acts.
 *
 * Greg, 2026-09-08: *"if I click on a session, show much more information about
 * it in the right column, e.g. input it requires from me, the recent messages,
 * and anything else that might be useful. Allow me to send steering messages to
 * it, answer its questions, etc"*.
 *
 * ## Six sections, in the order the question is usually asked
 *
 *  1. **What it needs from you**, which is the reason the page exists, so it is
 *     first and it is the only thing here drawn in the loud colour.
 *  2. **Do something to it** — the vocabulary as buttons (ActionButtons.tsx),
 *     with the two classes of action kept apart: a sentence the agent may
 *     ignore, and a command that runs whether or not it cooperates.
 *  3. **Say something to it** — a message, typed at the pane now, or queued to
 *     go in order with everything else pressed.
 *  4. **Waiting to go to it** — the queue, because a queue you cannot see
 *     surprises you an hour later in somebody else's conversation.
 *  5. **Recent messages**, which does not exist yet and says so. See below.
 *  6. **Where it is**, the identifiers and the directory, last because they are
 *     what you read when two rows look the same rather than what you came for.
 *
 * The session's **name** is editable in place under the title, because it is a
 * property of the session rather than something you do to it — and only here,
 * never on the list cards, where forty text inputs on a phone would be the
 * whole page. `RenameField` below carries the one rule nobody would guess.
 *
 * ## The slot, and why it is empty rather than plausible
 *
 * The transcript reader is stage v0.4c and is being built by somebody else.
 * `~/.claude/projects/<slug>/` is a slugified working directory and the
 * slugification is lossy, so the file has to be resolved from `row.meta.dir`
 * plus `row.claudeSessionId` — both of which are on this page, and both of
 * which are printed in the slot so it is obvious the material is here and the
 * reader is not. **An empty panel that says the messages are not wired up is
 * correct; a panel that shows nothing and looks finished is not** — a mocked
 * conversation would be the most expensive lie this tool can tell, for the same
 * reason the Orchestrator tab refuses to draw a fake decision log.
 *
 * ## Nothing here decides whether a send will be allowed
 *
 * The two buttons post and show whatever comes back. In particular this file
 * does NOT reimplement `steerableStatus` to grey out a shell: the server's
 * refusal carries the sentence that explains it — *"it is a shell, which would
 * EXECUTE the message"* — and a second copy here would be a rule to keep in
 * step with one that is already written down and enforced. The one thing that
 * IS checked locally is whether the row has the identifiers at all, because
 * that is a fact about the payload on screen rather than a claim about the box.
 */
import { useCallback, useState, type ReactNode } from "react";

import { ActionOutcomeCard, SessionActions, SessionQueue } from "./ActionButtons";
import { Handles, LaunchMode, QuestionCard, StatusPill, Uptime } from "./SessionParts";
import { Explain } from "./Tooltip";
import type { ActionOutcome } from "./actions-client";
import { NAME_RULE_TEXT, looksLikeAName, type RenameApi, type RenameOutcome } from "./rename-client";
import type { SteerApi, SteerOutcome } from "./steer-client";
import type { FleetGate, FleetRow } from "./types";
import type { ActionsUi } from "./useActions";
import { Button, Card, Mono, cx } from "./ui";
import { statusLabel, whereLine } from "./view";

/** A heading inside the detail. Quieter than the panel headings outside it. */
function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="tw:mt-3">
      <h3 className="tw:px-1 tw:pb-1.5 tw:text-[11px] tw:font-semibold tw:tracking-widest tw:text-ink-faint tw:uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * What became of the last send.
 *
 * **The server's sentence, not ours.** `why` knows things this page cannot —
 * *"pane %1646 is in session $1643 now, not $1"* — and the status code decides
 * only what to suggest next: 409 means the world moved under the view, which is
 * the one case where refreshing is the answer.
 */
function Outcome({ outcome, onRefresh }: { outcome: SteerOutcome; onRefresh: () => void }): ReactNode {
  if (outcome.ok) {
    return (
      <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-work/40 tw:bg-work-wash tw:p-3 tw:text-[13px]">
        <p className="tw:font-medium tw:text-work-ink">
          {outcome.op === "answer" ? "Answered." : "Sent."}
        </p>
        {outcome.sent.length > 0 ? (
          <p className="tw:mt-1 tw:text-ink-soft">
            {/* The argv, because "what did you actually press" is the first
                question anybody asks about a session that then did something
                surprising, and reconstructing it from prose is guesswork. */}
            Typed at the pane: <Mono>{outcome.sent.map((call) => call.join(" ")).join("  |  ")}</Mono>
          </p>
        ) : null}
        <p className="tw:mt-1 tw:text-ink-faint">
          The session's own reply lands in its terminal, not here. The list will catch up at the next
          collection.
        </p>
      </div>
    );
  }
  return (
    <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-3 tw:text-[13px]">
      <p className="tw:font-medium tw:text-alarm-ink">Nothing was sent.</p>
      {/* Verbatim. Every word of this is the server's. */}
      <p className="tw:mt-1 tw:break-words tw:text-ink">{outcome.why}</p>
      <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
        <Mono>{outcome.code}</Mono>
        {outcome.status === null ? null : (
          <>
            <span className="tw:px-1">·</span>
            <Mono>{`HTTP ${outcome.status}`}</Mono>
          </>
        )}
        <span className="tw:px-1">·</span>
        {outcome.from === "server" ? "said by the dashboard server" : "said by this browser"}
      </p>
      {outcome.status === 409 ? (
        <p className="tw:mt-2">
          <Button onClick={onRefresh}>Refresh and look again</Button>
        </p>
      ) : null}
    </div>
  );
}

/**
 * **Why this dialog is not tappable**, said before you tap rather than after.
 *
 * The page used to hold ALL answering back, which was too broad and was Greg's
 * push-back: *"mightn't there be other reasons why it needs to answer with
 * multiple choice to a session etc?"* It does — an agent's own
 * `AskUserQuestion` is a turn in a conversation, not a permission grant, and
 * refusing it bought nothing. So this card now appears for **one dialog at a
 * time**, and for a `conversation` dialog it does not appear at all.
 *
 * Three cases, and they are genuinely three:
 *
 *  - `why` non-null — the server has already refused a tap, and its own words
 *    are shown verbatim. This is sticky, because a control that refuses every
 *    time you press it is worse than one that says why it is not a control.
 *  - `permission` — answering would grant a capability. Not offered.
 *  - `unknown` — we could not tell, **including because the server never said**.
 *    Treated exactly as `permission`, which is the whole discipline: "I could
 *    not tell" must not become the way through.
 *
 * Sending a MESSAGE is unaffected in every case, and that distinction is drawn
 * here rather than left to be discovered by tapping.
 */
function HeldBack({ why, gate }: { why: string | null; gate: FleetGate }): ReactNode {
  if (why !== null) {
    return (
      <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-3 tw:text-[13px]">
        <p className="tw:font-medium tw:text-alarm-ink">The server would not answer this.</p>
        {/* Verbatim. It names the hazard and the way round it. */}
        <p className="tw:mt-1 tw:break-words tw:text-ink">{why}</p>
      </div>
    );
  }
  if (gate.kind === "conversation") return null;
  return (
    <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-unknown/40 tw:bg-unknown-wash tw:p-3 tw:text-[13px]">
      <p className="tw:font-medium tw:text-unknown-ink">
        {gate.kind === "permission" ? "This one grants a permission, so it is not a button." : "Not offered: I could not tell what this is."}
      </p>
      <p className="tw:mt-1 tw:break-words tw:text-ink-soft">{gate.why}</p>
      <p className="tw:mt-1 tw:text-ink-soft">
        This menu was read off a terminal, and screen text is not proof of what is being asked. Sending
        a digit can be a turn in a conversation; it must never be an approval. Answer it in the
        terminal — <code className="tw:font-mono">gjd-remote resume &lt;name&gt;</code> — or send a
        message below, which is not affected.
      </p>
    </div>
  );
}

/**
 * The session's name, editable in place.
 *
 * ## Save is NOT disabled when the text is unchanged, and that is the design
 *
 * Renaming a session to the name it already has is legal and is not a no-op: it
 * clears the session's *provisional* flag, which is the thing that otherwise
 * lets `gjd-remote ls` rename it back to Claude's own title later. So
 * re-submitting the same name is the gesture for *keep this one*, and a Save
 * greyed out because nothing has been typed would make the useful case the
 * impossible one. The hint under the box says so, because nobody would guess it.
 *
 * **What is deliberately not drawn:** which sessions are provisional. That
 * would be the natural place for a *save to keep this name* nudge, and it would
 * be a guess — the payload carries no such field today. A hint invented from a
 * plausible heuristic is worse than no hint, because it would be right most of
 * the time.
 *
 * ## The local check refuses only what the rule plainly refuses
 *
 * It saves the common typo a round trip and decides nothing else: anything it
 * lets through the server judges, and when the server refuses, **its sentence
 * goes on screen verbatim** — it spells out the rule, and it knows which
 * session already holds a taken name, which this page cannot.
 */
function RenameField({ row, rename }: { row: FleetRow; rename: RenameApi }): ReactNode {
  const [name, setName] = useState(row.name);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RenameOutcome | null>(null);

  const trimmed = name.trim();
  /* Empty is the one thing worth saying before a round trip, separately from
     the shape rule, because "type something" and "that shape is not allowed"
     are different sentences. */
  const localWhy =
    trimmed === "" ? "A session needs a name." : looksLikeAName(trimmed) ? null : NAME_RULE_TEXT;

  const save = useCallback(async (): Promise<void> => {
    setBusy(true);
    const result = await rename.rename(row, trimmed);
    setOutcome(result);
    // The name the SERVER settled on, so the box shows what is true of the box.
    if (result.ok) setName(result.name);
    setBusy(false);
  }, [rename, row, trimmed]);

  return (
    <div className="tw:mt-2">
      <label className="tw:text-[11px] tw:font-semibold tw:tracking-widest tw:text-ink-faint tw:uppercase" htmlFor="rename-name">
        Name
      </label>
      <div className="tw:mt-1 tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <input
          id="rename-name"
          type="text"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          className="tw:h-7 tw:min-w-0 tw:flex-1 tw:rounded-md tw:border tw:border-rule tw:bg-panel tw:px-2 tw:font-mono tw:text-[13px] tw:text-ink tw:disabled:opacity-50"
        />
        {/* Never disabled on "unchanged". See the header. */}
        <Button onClick={() => void save()} disabled={busy || localWhy !== null}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
        {localWhy ?? "Saving the same name again is not a no-op — it also stops the name being changed back later."}
      </p>
      {outcome === null ? null : outcome.ok ? (
        <p className="tw:mt-1 tw:text-[12px] tw:text-work-ink">
          {outcome.was === null ? (
            <>
              Renamed to <Mono>{outcome.name}</Mono>.
            </>
          ) : (
            <>
              Renamed from <Mono>{outcome.was}</Mono> to <Mono>{outcome.name}</Mono>.
            </>
          )}{" "}
          The list catches up at the next collection.
        </p>
      ) : (
        <div className="tw:mt-1 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-2.5 tw:text-[13px]">
          <p className="tw:font-medium tw:text-alarm-ink">Not renamed.</p>
          {/* Verbatim. It spells out the rule, or names who has the name. */}
          <p className="tw:mt-1 tw:break-words tw:text-ink">{outcome.why}</p>
          <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
            <Mono>{outcome.code}</Mono>
            <span className="tw:px-1">·</span>
            {outcome.from === "server" ? "said by the dashboard server" : "said by this browser"}
          </p>
          {outcome.code === "no-such-session" ? (
            <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">
              The box no longer lists this session under the handle this page is holding. Refresh and look again.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function SessionDetail({
  row,
  now,
  steer,
  rename,
  actions,
  onRefresh,
  onBack,
}: {
  row: FleetRow;
  now: number;
  steer: SteerApi;
  rename: RenameApi;
  /** The vocabulary, the queues, and the four requests that touch them. */
  actions: ActionsUi;
  /** Ask the box for a fresh snapshot — offered after a 409, which means stale. */
  onRefresh: () => void;
  /** Non-null only when the list is not on screen beside this, i.e. one pane. */
  onBack: (() => void) | null;
}): ReactNode {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SteerOutcome | null>(null);
  /**
   * The server's own sentence, once it has told us answering is switched off.
   *
   * Held rather than shown once and forgotten: after a refusal the options stop
   * being buttons, because a control that refuses every time you press it is
   * worse than one that says why it is not a control.
   */
  const [answeringOff, setAnsweringOff] = useState<string | null>(null);

  const label = statusLabel(row.status);
  const where = whereLine(row);
  const dir = row.meta.version === 1 ? row.meta.dir : null;

  /**
   * **The only local refusal.** `paneId` is the address and `claudeSessionId`
   * is the conversation; without either the server has nothing to check the
   * pane against and will refuse. Saying so here costs nothing and is a fact
   * about the payload on screen, not a guess about the box.
   */
  const unaddressable =
    row.paneId === null
      ? "this row has no tmux pane handle, which is the address a keystroke needs"
      : row.claudeSessionId === null
        ? "this row has no Claude session id, so there is no way to tell this conversation from whatever is in that pane now"
        : null;

  const send = useCallback(
    async (run: () => Promise<SteerOutcome>, clear: boolean): Promise<void> => {
      setBusy(true);
      const result = await run();
      setOutcome(result);
      // Both are sticky, and for the same reason: neither will come right by
      // pressing again. `answering-disabled` is the whole server switched off;
      // `grants-permission` is this dialog, and it can only change when the
      // dialog does — at which point the row is replaced and this state with it.
      if (!result.ok && (result.code === "answering-disabled" || result.code === "grants-permission")) {
        setAnsweringOff(result.why);
      }
      if (result.ok && clear) setText("");
      setBusy(false);
    },
    [],
  );

  const onAnswer = useCallback(
    (index: number) => {
      void send(() => steer.answer(row, index), false);
    },
    [row, send, steer],
  );

  const onSend = useCallback(() => {
    void send(() => steer.message(row, text), true);
  }, [row, send, steer, text]);

  /**
   * **Two buttons, because they are two different things.**
   *
   * Send types the message at the pane now, which is what you want for a
   * session sitting at a prompt and is useless for one that is working —
   * keystrokes into a busy Claude Code land in whatever the terminal is doing.
   * Queue puts it in the same ordered list the action buttons feed, so that
   * *"actually do X instead"* lands after the button that said do X and before
   * the one that said push. queue.ts: two queues cannot promise that, which is
   * why a queued message and a queued action go to one endpoint.
   *
   * Neither is offered as the automatic one. The server decides whether a send
   * is allowed and says why when it is not, and a page that silently converted
   * one gesture into the other would be answering a question nobody asked.
   */
  const [queueOutcome, setQueueOutcome] = useState<ActionOutcome | null>(null);
  const onQueue = useCallback(async (): Promise<void> => {
    setBusy(true);
    const result = await actions.api.queueMessage(row, text);
    setQueueOutcome(result);
    if (result.ok) setText("");
    setBusy(false);
    actions.refresh();
  }, [actions, row, text]);

  return (
    <Card
      className={cx(
        "session-detail tw:border-l-4 tw:p-4",
        label.tone === "needs" ? "tw:border-l-needs" : "tw:border-l-rule-strong",
      )}
    >
      {onBack === null ? null : (
        <p className="tw:mb-2">
          <Button onClick={onBack}>← All sessions</Button>
        </p>
      )}

      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1">
        <StatusPill status={row.status} />
        <Uptime row={row} now={now} className="tw:ml-auto" />
      </div>

      <h2
        className={cx(
          "tw:mt-1.5 tw:text-[17px] tw:leading-snug tw:font-medium tw:break-words",
          row.title === null && "tw:text-ink-faint tw:italic",
        )}
      >
        {row.title ?? "no title yet"}
      </h2>
      {label.detail === null ? null : (
        <p className="tw:mt-1 tw:text-[13px] tw:break-words tw:text-unknown-ink">{label.detail}</p>
      )}

      {/* The same strip as the list card, with the recovery spelled out —
          `detail` is what turns on the sentence saying what to press, and what
          lets the honest shrug (`cannot-tell`) show at all. Placed above the
          sections rather than inside "What it needs from you", because a
          session in manual mode is not asking you anything yet; it is about to
          stop asking anybody. */}
      <LaunchMode mode={row.permissionMode} detail />

      {/* Beside the title, because it is a property of this session rather than
          something you do to it — and NOT on the list cards, where forty text
          inputs on a phone would be the whole page. Keyed by the row up in
          SessionsPanel, so switching sessions resets the box. */}
      <RenameField row={row} rename={rename} />

      {/* ------------------------------------------- 1. what it needs -- */}
      <Section title="What it needs from you">
        {row.question !== null ? (
          <>
            <HeldBack why={answeringOff} gate={row.question.gate} />
            <QuestionCard
              question={row.question}
              onAnswer={
                unaddressable === null && answeringOff === null && row.question.gate.kind === "conversation"
                  ? onAnswer
                  : null
              }
              busy={busy}
            />
          </>
        ) : row.status.kind === "needs-you" ? (
          <p className="tw:text-[13px] tw:text-ink-soft">
            It is waiting for a person, and no dialog could be read off the pane — so there is nothing
            here to press. A message below may be what it is waiting for; otherwise the terminal is the
            place to look.
          </p>
        ) : (
          <p className="tw:text-[13px] tw:text-ink-soft">Nothing. It is not asking you anything.</p>
        )}
        {unaddressable === null ? null : (
          <p className="tw:mt-2 tw:text-[13px] tw:text-alarm-ink">{unaddressable}</p>
        )}
      </Section>

      {/* ------------------------------------------------- 2. actions -- */}
      <Section title="Do something to it">
        <SessionActions
          row={row}
          feed={actions.feed}
          api={actions.api}
          asked={actions.asked}
          error={actions.error}
          unaddressable={unaddressable}
          onChanged={actions.refresh}
        />
      </Section>

      {/* ------------------------------------------------ 3. steering -- */}
      <Section title="Say something to it">
        <label className="tw:sr-only" htmlFor="steer-text">
          A message to send to this session
        </label>
        <textarea
          id="steer-text"
          value={text}
          rows={3}
          disabled={busy || unaddressable !== null}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. pull the latest dev and carry on"
          className="tw:w-full tw:rounded-md tw:border tw:border-rule tw:bg-panel tw:p-2 tw:text-[14px] tw:text-ink tw:disabled:opacity-50"
        />
        <div className="tw:mt-1.5 tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          <Button variant="loud" onClick={onSend} disabled={busy || text.trim() === "" || unaddressable !== null}>
            {busy ? "Sending…" : "Send"}
          </Button>
          {/* The second gesture, not a fallback for the first. See `onQueue`. */}
          <Button onClick={() => void onQueue()} disabled={busy || text.trim() === "" || unaddressable !== null}>
            Queue it
          </Button>
          {/* The newline rule is the server's and is checked there. It is worth
              saying up front because it is surprising: Claude Code's input box
              submits on Enter, so a two-line message would arrive as two, the
              first of them half a sentence. */}
          <span className="tw:text-[12px] tw:text-ink-faint">One line — a newline would submit it early.</span>
        </div>
        <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
          Send types it at the pane now. Queue puts it in the line below with anything else you have pressed, in
          order, to go when the session is next at a prompt.
        </p>
      </Section>

      {outcome === null ? null : <Outcome outcome={outcome} onRefresh={onRefresh} />}
      {queueOutcome === null ? null : <ActionOutcomeCard outcome={queueOutcome} onRefresh={actions.refresh} />}

      {/* --------------------------------------------- 4. the queue -- */}
      <Section title="Waiting to go to it">
        <SessionQueue
          sessionId={row.id}
          feed={actions.feed}
          api={actions.api}
          asked={actions.asked}
          error={actions.error}
          onChanged={actions.refresh}
        />
      </Section>

      {/* ---------------------------------------- 5. the empty slot -- */}
      <Section title="Recent messages">
        <div className="tw:rounded-lg tw:border tw:border-dashed tw:border-rule-strong tw:p-3 tw:text-[13px] tw:text-ink-soft">
          <p className="tw:font-medium tw:text-ink">Recent messages are not wired up yet.</p>
          <p className="tw:mt-1">
            Nothing on this page has read this session's transcript. Reading the tail of one is stage
            v0.4c — the whole file is tens of megabytes and grepping it costs ten seconds, which is
            the thing this tool exists not to do.
          </p>
          <p className="tw:mt-1 tw:text-ink-faint">
            What it will be resolved from, both of which are already here:
          </p>
          <p className="tw:mt-1">
            <Mono>{dir ?? "no directory recorded for this session"}</Mono>
          </p>
          <p className="tw:mt-0.5">
            <Mono>{row.claudeSessionId ?? "no Claude session id"}</Mono>
          </p>
        </div>
      </Section>

      {/* --------------------------------------------- 6. where it is -- */}
      <Section title="Where it is">
        {where === null ? (
          <p className="tw:text-[13px] tw:text-ink-faint">no repo recorded</p>
        ) : (
          <p className="tw:text-[13px] tw:break-words tw:text-ink-soft">{where}</p>
        )}
        {dir === null ? (
          <p className="tw:mt-1 tw:text-[13px] tw:text-ink-faint">
            no working directory recorded — this session predates the launcher writing one down
          </p>
        ) : (
          <Explain
            tip={{
              head: "Working directory",
              what: dir,
              how: "The only place the full path exists. The name above is its last segment, and two worktrees can differ by a word — so this is what tells them apart, and what a transcript would be found from.",
            }}
            placement="top"
            className="tw:mt-1 tw:block tw:text-[13px] tw:break-words tw:text-ink-soft"
          >
            <Mono>{dir}</Mono>
          </Explain>
        )}
        <Handles row={row} full />
        <p className="tw:mt-1 tw:text-[11px] tw:text-ink-faint">
          Session handle, pane handle, the pane's pid and the conversation's own id. All four go back
          to the server with anything you send, exactly as they arrived, so it can check the pane is
          still the one you were looking at.
        </p>
      </Section>
    </Card>
  );
}

/**
 * The pane when the selected session is not in the latest snapshot.
 *
 * **A row that disappears is information, not an error.** The session may have
 * exited, or the collector may have failed to see it — and either way the id is
 * still in the URL, so silently falling back to "nothing selected" would erase
 * the fact that something was there a minute ago.
 */
export function MissingSession({ id, onBack }: { id: string; onBack: () => void }): ReactNode {
  return (
    <Card className="tw:border-l-4 tw:border-l-unknown tw:p-4">
      <h2 className="tw:font-medium">That session is not in the latest snapshot.</h2>
      <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
        <Mono>{id}</Mono> was selected and the box did not list it this time round. It may have
        exited, or the collection may have missed it — the age and any error in the masthead say
        which is more likely.
      </p>
      <p className="tw:mt-3">
        <Button onClick={onBack}>← All sessions</Button>
      </p>
    </Card>
  );
}
