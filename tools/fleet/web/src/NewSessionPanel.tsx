/**
 * Starting an agent from the page.
 *
 * Greg, 2026-09-08: *"I want a way to add a New session, with a text input box,
 * perhaps using `gjd-remote new-claude -p ...` so that I can still use that
 * machinery to manage things."* The parenthesis is the design and it belongs to
 * the server (tools/fleet/routes-new.ts); what is left for this file is the box
 * to type in and, mostly, **telling the truth about what happened afterwards.**
 *
 * ## Three states, and the third one is the whole job
 *
 * The POST answers **202**, not 200: `new-claude` takes tens of seconds — six
 * ssh round trips and a setup handshake — so the request cannot wait for it.
 * The launch then moves `starting` → `started` | `failed`, and this panel polls
 * `GET /api/sessions/new` until it settles.
 *
 * **`failed` with `maybeStarted: true` is the state a two-state design would
 * have to lie about.** It means the answer was lost rather than a refusal
 * received — a timeout, a launcher that vanished — so a Claude may well be
 * running on the box right now. The honest sentence is *check the list and kill
 * it if it is there*, and "nothing happened" is wrong about exactly the case
 * that costs something: an agent nobody knows they started, on a machine that
 * hit load 391 the day this was written.
 *
 * ## What is deliberately not asked for
 *
 * **No name.** Omitting it makes gjd-remote start Claude without `--name`, so
 * Claude titles the conversation itself and the list adopts that title; a name
 * chosen in this box would freeze a placeholder over the top of it forever.
 * **No directory** either — the server has a default and a root allowlist, and
 * a picker is not what was asked for. The record that comes back says which
 * directory was used, which is the half that matters.
 *
 * The polling is per-panel rather than folded into `useFleetState`, and that is
 * on purpose: this is a different resource with a different lifetime — it runs
 * only while a launch is in flight, and stops. Adding it to the fleet poll
 * would make every reader of the page fetch it forever.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { DictationControl, useFleetDictation } from "./DictationControl";
import type { LaunchRecord, NewSessionApi } from "./new-session-client";
import { Button, Card, Mono, cx } from "./ui";

/** How often to ask what became of a launch. */
export const POLL_MS = 3_000;

/**
 * When to stop asking.
 *
 * A launch that has been `starting` for four minutes is one the server's own
 * timeout has already given up on, so polling past that is a page quietly
 * fetching forever in a tab nobody is looking at. It stops and says so rather
 * than spinning: **a spinner with no end is a lie about there being progress.**
 *
 * **It is an ABSOLUTE deadline from the moment polling started, and it applies
 * to the polls that never answered as much as to the ones that did.** Until
 * 2026-09-08 the failure branch returned before reaching this line, so the one
 * case the deadline is really for — the server gone, the tab left open — was
 * the one case it did not cover.
 *
 * **And it is checked by the CLOCK, not by a poll finishing**, which is the
 * second half of the same lesson and the one that survived the first fix. GPT
 * Sol, 2026-09-08: a `poll()` whose promise never settles — the connection
 * accepted, the proxy never answering — reaches no branch at all, so a deadline
 * evaluated after `await` is a deadline that the exact failure it exists for
 * can walk straight past. The interval now decides, and a poll in flight cannot
 * hold the decision open. See `GaveUp` for what the two endings may claim.
 *
 * **And the clock is read again when an answer ARRIVES, not only when the
 * interval ticks.** GPT Sol's F9, 2026-09-10, is the rule: *a poll begun before
 * the deadline but resolving after it must not update the launch or erase the
 * give-up state; the absolute deadline wins, the late result is discarded, and
 * no further poll starts.* Checked only at the tick, there was a window of up to
 * `POLL_MS` — the tick that lands exactly on the deadline does not pass it, so
 * the give-up tick is the one after — in which a late answer was applied as
 * though it were on time and no give-up was ever drawn. The price is that a real
 * `started` arriving a second late is thrown away; the banner says the session
 * list is the authority, which is where it will show. tests/fleet-new-session-deadline.test.tsx.
 */
export const POLL_GIVE_UP_MS = 4 * 60_000;

/** A rejected injected API is outside the normal HTTP adapter, but must still end as a sentence rather than an unhandled promise. */
function rejectedStart(cause: unknown): string {
  const why =
    cause instanceof Error
      ? cause.message === ""
        ? cause.name
        : cause.message
      : typeof cause === "string" && cause !== ""
        ? cause
        : "the request failed, and gave no reason";
  return `the request failed before it answered: ${why}`;
}

/**
 * Why the page stopped asking — and they are not the same sentence.
 *
 * `still-starting` means a usable status came back at some point and the launch
 * had not settled: the server's own timeout has passed, so the honest next step
 * is the session list. `no-answer` means nothing usable ever came back, and the
 * only thing this page knows is its own ignorance — repeating the
 * four-minutes-starting sentence there would be reporting an observation nobody
 * made. Same discipline as `maybeStarted` above: the state a two-state design
 * would have to lie about gets to say what it really is.
 *
 * **The discriminator is "did anything usable ever come back", not "did the LAST
 * attempt fail"**, and that distinction is Sol's, 2026-09-08. Choosing the arm
 * from the final poll alone meant that four minutes of healthy `busy: true`
 * followed by one `ECONNRESET` printed *"for four minutes it could not reach the
 * server at all"* — false about all but the last three seconds of it.
 * `lastError` carries that final failure into the `still-starting` arm instead,
 * where it is a footnote rather than the headline.
 *
 * **And this arm is `no-answer`, not `unreachable`, which was Sol's round 2.**
 * `PollOutcome.ok` is false for an HTTP 500 and for a body that is not this API
 * as well as for a dead socket (`new-session-client.ts`), so a panel claiming
 * the server could not be REACHED and then quoting its 500 was contradicting
 * itself inside one sentence. What this page can honestly report is whether it
 * ever got an answer it could use. **A name that claims more than its evidence
 * supports is the same bug as a sentence that does**, and it is easier to miss.
 */
type GaveUp =
  | { kind: "still-starting"; lastError: string | null }
  | { kind: "no-answer"; why: string };

/** What a launch record means, in a sentence, and how loudly to say it. */
function launchLine(record: LaunchRecord): { tone: "work" | "needs" | "alarm" | "idle"; head: string; body: string } {
  if (record.progress.state === "starting") {
    return {
      tone: "work",
      head: "Starting…",
      body: "gjd-remote is bringing it up — six ssh round trips and a setup handshake, so tens of seconds. Nothing has succeeded yet.",
    };
  }
  if (record.progress.state === "started") {
    return {
      tone: "work",
      head: `Started${record.name === null ? "" : ` as ${record.name}`}.`,
      body: "It will appear in the list at the next collection, under whatever title Claude gives the conversation.",
    };
  }
  if (record.maybeStarted) {
    return {
      tone: "alarm",
      head: "Failed — and it may have started anyway.",
      body: "The answer was lost rather than refused, so a Claude may be running on the box right now. Check the list, and kill it if it is there.",
    };
  }
  return { tone: "needs", head: "Failed. Nothing was started.", body: "" };
}

/**
 * WHETHER THE OVERSEER WAS TOLD, AND WHAT "TOLD" HONESTLY MEANS HERE.
 *
 * Greg asked that starting a session from the web UI notify the Overseer. The
 * dashboard does not type at a pane to do it — it hands one line to the shared
 * steering queue, and the drain delivers it on a later refresh through the same
 * coordinator every other producer uses. So the best case this can report is
 * **queued**, and it says that rather than implying a delivery: what became of
 * the keystrokes is the queue's story, and its own surface tells it.
 *
 * **Every arm is drawn, including the quiet ones.** Nobody holding the role is a
 * real answer — it is what a box looks like after a reboot — and it is a
 * different fact from not being able to tell who holds it. A card that showed
 * only the happy case would leave a reader assuming the Overseer knows.
 *
 * `starting` and `failed` draw nothing: nothing has been attempted yet, and a
 * launch that never started has nobody to tell.
 */
function NotifiedLine({ progress }: { progress: LaunchRecord["progress"] }): ReactNode {
  if (progress.state !== "started") return null;
  const n = progress.notification;

  const said = ((): { text: string; tone: "soft" | "faint" | "unknown" } => {
    switch (n.kind) {
      case "pending":
        return { text: "Telling the Overseer…", tone: "faint" };
      case "queued":
        return {
          text: `Queued for ${n.to} — position ${n.position}. It goes out on a later refresh; this page cannot say whether it was read.`,
          tone: "soft",
        };
      case "not-queued":
        return { text: `Not queued for ${n.to} (${n.rule}): ${n.why}`, tone: "unknown" };
      case "no-holder":
        return { text: "Nobody holds the Overseer role, so nothing was queued.", tone: "unknown" };
      case "contested":
        return {
          text: `${n.names.length} sessions claim the Overseer role (${n.names.join(", ")}), so nothing was queued.`,
          tone: "unknown",
        };
      case "cannot-tell":
        return { text: `Could not tell who to notify: ${n.why}`, tone: "unknown" };
    }
  })();

  const colour =
    said.tone === "unknown" ? "tw:text-unknown-ink" : said.tone === "faint" ? "tw:text-ink-faint" : "tw:text-ink-soft";
  return <p className={cx("tw:mt-1 tw:text-[13px] tw:break-words", colour)}>{said.text}</p>;
}

/**
 * How to say "this went in through `-d`" without claiming it started.
 *
 * A `Record` over the closed `LaunchState` rather than a ternary, so that a
 * fourth state — if `LaunchRecord` ever grows one — fails the build here instead
 * of quietly inheriting the past tense, which is the tense that lies. Only
 * `started` is a confirmed start; `starting` has not finished, and `failed`
 * covers both "refused" and "the answer was lost", neither of which may be
 * reported as a thing that happened.
 */
const DASH_D_VERB: Record<LaunchRecord["progress"]["state"], string> = {
  starting: "Using",
  started: "Started with",
  /* Not "attempted and did not start": `maybeStarted` says a Claude may well be
     running, and the headline above already draws that distinction. This line is
     only about which door was used. */
  failed: "Attempted with",
};

const TONE_BORDER: Record<"work" | "needs" | "alarm" | "idle", string> = {
  work: "tw:border-l-work",
  needs: "tw:border-l-needs",
  alarm: "tw:border-l-alarm",
  idle: "tw:border-l-rule-strong",
};

function Launch({ record }: { record: LaunchRecord }): ReactNode {
  const line = launchLine(record);
  return (
    <li className={cx("tw:mt-2 tw:rounded-lg tw:border tw:border-rule tw:border-l-4 tw:p-3", TONE_BORDER[line.tone])}>
      <p className="tw:text-[13px] tw:font-medium tw:break-words">{line.head}</p>
      {line.body === "" ? null : <p className="tw:mt-1 tw:text-[13px] tw:text-ink-soft">{line.body}</p>}
      {/* The server's own sentence, when it gave one. */}
      {record.error === null ? null : (
        <p className="tw:mt-1 tw:text-[13px] tw:break-words tw:text-alarm-ink">{record.error}</p>
      )}
      {record.note === null ? null : (
        <p className="tw:mt-1 tw:text-[13px] tw:break-words tw:text-ink-soft">{record.note}</p>
      )}
      <NotifiedLine progress={record.progress} />

      {/* **WHERE IT ACTUALLY STARTED, WHEN THAT IS NOT WHERE IT WAS ASKED TO.**
          The header above promises that "the record that comes back says which
          directory was used, which is the half that matters" — and until
          2026-09-08 this client parsed `dir`, the directory that was ASKED for,
          and dropped `startedDir`, the one the box chose. In repo mode the box
          resolves a worktree to the checkout it belongs to, so the two really
          do differ, and the reader was being shown the wrong one under a
          comment saying it was the right one. Instance 14 in the table in
          docs/postmortems/260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md.

          Only drawn when they differ: printing the same path twice on every
          ordinary launch is how a line that matters stops being read. */}
      {record.startedDir !== null && record.startedDir !== record.dir ? (
        <p className="tw:mt-1 tw:text-[12px] tw:break-words tw:text-ink-soft">
          Started in <Mono>{record.startedDir}</Mono>, not the directory that was asked for — the box
          resolves a repo to its own checkout, and a worktree to the checkout it belongs to.
        </p>
      ) : null}
      {/* **THE ESCAPE HATCH SAYS SO.** `dir` means the launch went in through
          `-d`, which skips the repo's setup status and starts the session
          OUTSIDE the setup lock — the thing that once let this dashboard start
          an agent in a checkout `gjd-remote setup` was rewriting. `repo` is the
          ordinary path and gets no line, because a caveat drawn on every row is
          one nobody reads; `null` gets none either, since an older server made
          no claim. new-session-client.ts § `LaunchResolution`.

          **THE VERB IS THE STATE'S, NOT THE FIELD'S.** The server assigns
          `resolution` when the record is minted, while it still says `starting`,
          and keeps it when the launch fails (routes-new.ts) — so this line said
          *"Started with `-d`"* on a card whose headline said *"Starting…"* or
          *"Failed. Nothing was started."* One card, two tenses, contradicting
          each other about whether anything ran. GPT Sol's M4. */}
      {record.resolution === "dir" ? (
        <p className="tw:mt-1 tw:text-[12px] tw:break-words tw:text-alarm-ink">
          {DASH_D_VERB[record.progress.state]} <Mono>-d</Mono>: outside the repo's setup lock, and without
          reading its setup status.
        </p>
      ) : null}
      <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
        <Mono>{record.dir}</Mono>
        <span className="tw:px-1">·</span>
        {record.promptBytes} bytes of prompt
      </p>
    </li>
  );
}

export function NewSessionPanel({ api }: { api: NewSessionApi }): ReactNode {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  /** The server's refusal verbatim, or this boundary's sentence when an injected API rejects. */
  const [refusal, setRefusal] = useState<string | null>(null);
  const [launches, setLaunches] = useState<LaunchRecord[]>([]);
  const [pollingSince, setPollingSince] = useState<number | null>(null);
  const [gaveUp, setGaveUp] = useState<GaveUp | null>(null);

  /* The api in a ref so the polling effect depends on whether it is polling and
     not on the identity of its dependencies — a fresh `api` object per render
     would otherwise restart the interval every tick. */
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    if (pollingSince === null) return;
    /**
     * Nothing more happens under this launch — the effect was torn down, or the
     * launch settled, or we gave up. One flag rather than the three separate
     * ones this had first: they were checked together everywhere, and Sol's
     * round 2 was right that three names for one condition is three chances to
     * check the wrong one.
     */
    let stopped = false;
    /**
     * **ONE ASK AT A TIME.** A three-second interval over a request that takes
     * longer than three seconds is not a poll, it is a queue — and against a
     * route that has stopped answering it is an unbounded one. Sol's finding,
     * 2026-09-08.
     */
    let inFlight = false;
    /**
     * Has a **usable status** ever come back — not merely a TCP connection.
     *
     * This was called `heard` and meant "the transport worked", which is not
     * what `PollOutcome.ok` distinguishes: `new-session-client.ts` also answers
     * `{ok: false}` for an HTTP 500 and for a body that is not this API. So four
     * minutes of the dashboard answering 500 said *"could not reach the server
     * at all (the server answered 500)"* — a sentence that contradicts itself in
     * its own parenthesis. Sol's round 2, and the fix is the honest reading
     * rather than a new field: what this page can truthfully report is whether
     * it ever got an **answer it could use**, and the copy now says that.
     */
    let usable = false;
    /** The most recent failure's own words, or null if the last ask answered. */
    let lastError: string | null = null;

    /** Past the absolute deadline, by the clock. `>` so the deadline itself is still on time. */
    const expired = (): boolean => Date.now() - pollingSince > POLL_GIVE_UP_MS;

    const ask = async (): Promise<void> => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const result = await apiRef.current.poll();
        if (stopped) return;
        /* **The deadline wins over a late answer** — F9, in the header. Before
           the result is read at all, success or failure: an answer that lands
           after the deadline is not news this page may act on, and the give-up
           it triggers stops the interval, so nothing further is asked. */
        if (expired()) {
          giveUp();
          return;
        }
        if (!result.ok) {
          /* **The launches are left exactly as they are.** A failed ask is not
             news about the launch, and the record carries the only id anybody
             has for a Claude that may be running; clearing it here would lose
             the thing the honest ending is about. Nor is anything retried: a
             page that relaunches because discovery failed turns one press into
             two agents on a box that has already met the OOM killer. */
          lastError = result.why;
          return;
        }
        usable = true;
        lastError = null;
        setLaunches(result.feed.launches);
        /* Stop when nothing is in flight. `busy` from the server rather than
           our own idea of it: the slot is released by the launch, not by this
           page. **Settled beats expired** — a launch that finished on the last
           ask is finished, not abandoned, and `stopped` here is what keeps the
           tick below from overwriting that with a give-up. */
        if (!result.feed.busy && !result.feed.launches.some((l) => l.progress.state === "starting")) {
          stopped = true;
          setPollingSince(null);
        }
      } finally {
        inFlight = false;
      }
    };

    const giveUp = (): void => {
      if (stopped) return;
      stopped = true;
      setPollingSince(null);
      setGaveUp(
        usable
          ? { kind: "still-starting", lastError }
          : /* Nothing usable ever came back. `lastError` is null exactly when no
               ask ever COMPLETED — the never-settling promise — and that
               deserves its own words rather than an empty parenthesis. */
            { kind: "no-answer", why: lastError ?? "no answer ever arrived" },
      );
    };

    void ask();
    const timer = setInterval(() => {
      /* The clock decides, before anything is asked. An ask still in flight is
         abandoned with the rest of the effect: this page has stopped asking,
         and the session list is the thing in a position to answer. */
      if (expired()) {
        giveUp();
        return;
      }
      void ask();
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pollingSince]);

  /* The box itself, so the dictation knows where the caret is. */
  const box = useRef<HTMLTextAreaElement>(null);
  /* `new-session` rather than a session id: this prompt relates to no agent yet,
     so the vocabulary it is primed with is the whole fleet's names — which is
     right, because what somebody types here is usually about the sessions and
     worktrees that already exist. */
  const dictate = useFleetDictation({
    value: prompt,
    onChange: setPrompt,
    box,
    context: { kind: "new-session" },
  });

  /**
   * **CLOSING THE PANEL MUST STOP THE MICROPHONE, because closing it unmounts
   * nothing.**
   *
   * `open` only decides whether the box and its controls are *rendered*; this
   * component stays mounted either way, so `useDictation`'s cleanup never runs
   * and a dictation started before Close carries on recording behind a panel
   * with no Stop button on it. There is no way back to it: the toggle is inside
   * the branch that just disappeared.
   *
   * The product hit this exact shape in its Feedback dialog, and
   * docs/project/dictation.md names it — *"if the box lives in a component that
   * stays mounted when it disappears… closing it unmounts nothing"*. GPT Sol
   * found it here as a P1 on 2026-09-08, in code written by somebody who had
   * read that sentence and not applied it.
   *
   * `dictation.toggle`, not the field wrapper's `toggle`, which would put the
   * focus back into a box that is no longer on screen.
   */
  /* **Read at the moment of sending, not captured when `start` was built.**
     `start`'s dependency list is `[prompt]`, so a `dictate.sendBlocked` read
     inside it is whatever it was when the prompt last changed — and the case
     that matters is somebody pressing Dictate and then Start without typing,
     where the closure still holds `false`. The DOM `disabled` was protective and
     the action-boundary guard, which is the one that survives a programmatic
     call, was not. GPT Sol's round 2, finding 1; `SessionDetail` had the ref
     pattern already and this file did not copy it. */
  const blocked = useRef(dictate.sendBlocked);
  blocked.current = dictate.sendBlocked;

  const armed = dictate.dictation.armed;
  const stopMic = dictate.dictation.toggle;
  useEffect(() => {
    if (!open && armed) stopMic();
  }, [open, armed, stopMic]);

  /* **ONE POST AT A TIME, guarded in the action.** `busy` disables the button,
     but only once the page has redrawn: a second tap that lands before then —
     or any programmatic call — reached `apiRef.current.start` again, and two
     POSTs are two Claudes on a box that has met the OOM killer. The same
     reasoning as `blocked` above, and a ref for the same reason: a state read
     inside `start` is whatever it was when the closure was built.
     tests/fleet-new-session-deadline.test.tsx, "two taps". */
  const posting = useRef(false);

  const start = useCallback(async () => {
    /* **The guard lives here as well as on the button**, because `disabled` is a
       property of a rendered element and this is the action. A programmatic
       call, or a keyboard path somebody adds later, would otherwise start an
       agent on the rough live guesses — or, on Safari and Firefox, on nothing
       that was said at all. GPT Sol's review of the built code, finding 6. */
    if (blocked.current || posting.current) return;
    posting.current = true;
    setBusy(true);
    setRefusal(null);
    let result: Awaited<ReturnType<NewSessionApi["start"]>>;
    try {
      result = await apiRef.current.start(prompt);
    } catch (cause) {
      /* The real HTTP adapter returns every ordinary failure as an outcome, but
         this is an injected seam and its promise may still reject. Letting that
         escape `void start()` reports nothing to the reader and becomes an
         unhandled rejection even though the action guard is correctly released. */
      setRefusal(rejectedStart(cause));
      return;
    } finally {
      /* Released however the POST ends, so an api that throws cannot leave the
         button dead for the life of the page. `setBusy` moved in here with it:
         after the `await`, the updates below batch with this one either way. */
      posting.current = false;
      setBusy(false);
    }
    if (result.accepted) {
      setPrompt("");
      const launch = result.launch;
      if (launch !== null) setLaunches((old) => [launch, ...old.filter((l) => l.id !== launch.id)]);
      /* **CLEARED ON ACCEPTANCE, NOT ON PRESSING THE BUTTON.** This used to sit
         beside `setRefusal(null)` above, which threw away the previous launch's
         warning before anybody knew whether a new one would replace it: press
         Start again while the box is critical, get a 503, and the "stopped
         asking about that launch" banner is gone while the launch it was about
         is still on screen saying "Starting…". The warning belongs to a launch,
         so only a launch may retire it. Sol's third finding, 2026-09-08. */
      setGaveUp(null);
      setPollingSince(Date.now());
    } else {
      // Verbatim. The server knows about the cooldown, the box's health and the
      // prompt size limit, and none of those sentences should be rewritten here.
      setRefusal(result.why);
    }
  }, [prompt]);

  return (
    <Card className="tw:mb-3 tw:p-3">
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Button onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Close" : "New session"}
        </Button>
        <span className="tw:text-[12px] tw:text-ink-faint">
          Starts a Claude on the box through <Mono>gjd-remote new-claude</Mono>, so it shows up here and{" "}
          <Mono>gjd-remote kill</Mono> can stop it.
        </span>
      </div>

      {open ? (
        <div className="tw:mt-3">
          <label className="tw:sr-only" htmlFor="new-session-prompt">
            What the new session should do
          </label>
          <textarea
            id="new-session-prompt"
            ref={box}
            value={prompt}
            rows={4}
            disabled={busy}
            /* `readOnly`, NOT `disabled`, while the transcript is on its way:
               `disabled` drops the selection, and the selection is the caret the
               words are about to be inserted at. */
            readOnly={dictate.readOnly}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should it do? This is the whole prompt the agent wakes up with."
            className="tw:w-full tw:rounded-md tw:border tw:border-rule tw:bg-panel tw:p-2 tw:text-[14px] tw:text-ink tw:disabled:opacity-50"
          />
          <div className="tw:mt-1.5 tw:flex tw:flex-wrap tw:items-center tw:gap-2">
            {/* **`sendBlocked`, not `readOnly`.** Pressing this while the
                microphone is still on would start an agent on the rough live
                guesses — or, on Safari and Firefox, on nothing that was said at
                all. And the button is DISABLED as well as guarded: a correct
                guard behind a lit button is a press that does nothing and says
                nothing, which is the worse half of the pair. */}
            <Button
              variant="loud"
              onClick={() => void start()}
              disabled={busy || prompt.trim() === "" || dictate.sendBlocked}
            >
              {busy ? "Asking…" : "Start it"}
            </Button>
            <DictationControl dictation={dictate.dictation} toggle={dictate.toggle} />
            <span className="tw:text-[12px] tw:text-ink-faint">
              No name and no directory: Claude titles the conversation itself, and the server picks the
              directory from its own allowlist.
            </span>
          </div>
        </div>
      ) : null}

      {refusal === null ? null : (
        <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-3 tw:text-[13px]">
          <p className="tw:font-medium tw:text-alarm-ink">It would not start one.</p>
          <p className="tw:mt-1 tw:break-words tw:text-ink">{refusal}</p>
        </div>
      )}

      {launches.length === 0 ? null : (
        <ul className="tw:mt-1">
          {launches.map((record) => (
            <Launch key={record.id} record={record} />
          ))}
        </ul>
      )}

      {/* **TWO ENDINGS, AND ONLY ONE OF THEM SAW ANYTHING.** See `GaveUp`. The
          closing sentence is shared because it is the same advice either way —
          the session list is the only thing in a position to answer. */}
      {gaveUp === null ? null : (
        <p className="tw:mt-2 tw:text-[13px] tw:break-words tw:text-alarm-ink">
          {gaveUp.kind === "still-starting" ? (
            <>
              This page has stopped asking what became of that launch — it was still starting four
              minutes on, which is longer than the server's own timeout.
              {gaveUp.lastError === null ? null : ` The last attempt to ask failed: ${gaveUp.lastError}.`}
            </>
          ) : (
            <>
              This page has stopped asking what became of that launch — for four minutes it never got
              a usable status answer ({gaveUp.why}), so it never found out whether one started.
              Nothing was retried and nothing was started a second time.
            </>
          )}{" "}
          Whether a session exists is a question for the list, not for this panel.
        </p>
      )}
    </Card>
  );
}
