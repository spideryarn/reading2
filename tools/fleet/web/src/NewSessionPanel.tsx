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
 */
export const POLL_GIVE_UP_MS = 4 * 60_000;

/** What a launch record means, in a sentence, and how loudly to say it. */
function launchLine(record: LaunchRecord): { tone: "work" | "needs" | "alarm" | "idle"; head: string; body: string } {
  if (record.state === "starting") {
    return {
      tone: "work",
      head: "Starting…",
      body: "gjd-remote is bringing it up — six ssh round trips and a setup handshake, so tens of seconds. Nothing has succeeded yet.",
    };
  }
  if (record.state === "started") {
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
  /** The server's refusal of the POST itself, verbatim. */
  const [refusal, setRefusal] = useState<string | null>(null);
  const [launches, setLaunches] = useState<LaunchRecord[]>([]);
  const [pollingSince, setPollingSince] = useState<number | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  /* The api in a ref so the polling effect depends on whether it is polling and
     not on the identity of its dependencies — a fresh `api` object per render
     would otherwise restart the interval every tick. */
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    if (pollingSince === null) return;
    let stopped = false;
    const ask = async (): Promise<void> => {
      const result = await apiRef.current.poll();
      if (stopped || !result.ok) return;
      setLaunches(result.feed.launches);
      /* Stop when nothing is in flight. `busy` from the server rather than our
         own idea of it: the slot is released by the launch, not by this page. */
      if (!result.feed.busy && !result.feed.launches.some((l) => l.state === "starting")) {
        setPollingSince(null);
      } else if (Date.now() - pollingSince > POLL_GIVE_UP_MS) {
        setPollingSince(null);
        setGaveUp(true);
      }
    };
    void ask();
    const timer = setInterval(() => void ask(), POLL_MS);
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
  const armed = dictate.dictation.armed;
  const stopMic = dictate.dictation.toggle;
  useEffect(() => {
    if (!open && armed) stopMic();
  }, [open, armed, stopMic]);

  const start = useCallback(async () => {
    /* **The guard lives here as well as on the button**, because `disabled` is a
       property of a rendered element and this is the action. A programmatic
       call, or a keyboard path somebody adds later, would otherwise start an
       agent on the rough live guesses — or, on Safari and Firefox, on nothing
       that was said at all. GPT Sol's review of the built code, finding 6. */
    if (dictate.sendBlocked) return;
    setBusy(true);
    setRefusal(null);
    setGaveUp(false);
    const result = await apiRef.current.start(prompt);
    if (result.accepted) {
      setPrompt("");
      const launch = result.launch;
      if (launch !== null) setLaunches((old) => [launch, ...old.filter((l) => l.id !== launch.id)]);
      setPollingSince(Date.now());
    } else {
      // Verbatim. The server knows about the cooldown, the box's health and the
      // prompt size limit, and none of those sentences should be rewritten here.
      setRefusal(result.why);
    }
    setBusy(false);
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

      {gaveUp ? (
        <p className="tw:mt-2 tw:text-[13px] tw:text-alarm-ink">
          This page has stopped asking what became of that launch — it has been starting for four
          minutes, which is longer than the server's own timeout. Whether a session exists is a
          question for the list, not for this panel.
        </p>
      ) : null}
    </Card>
  );
}
