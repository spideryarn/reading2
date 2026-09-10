/**
 * Interrupted work: what a reboot or a tmux restart left behind, as the
 * Overseer recorded it — shown, with **one** control.
 *
 * docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md
 * § 6 built the evidence; plan 260910f (Stage 2) adds the one control. An
 * `interrupted` record whose resume is `supported`, under a published resume
 * section with a wired launcher and a preview with a pinned account, gets
 * **Resume…**: an inline confirmation (no dialogs on this page) whose one button
 * queues one request through `POST /api/recovery/resume`. Every other record
 * gets manual instructions or nothing, and `unknown`, `present-but-unmatched`
 * and `ended-before-reboot` get no control of any kind. There are still no
 * links that act: manual instructions are display text in a code element, built
 * only from a strict uuid and shell-quoted paths, and `manual` is still drawn as
 * "on <host>, in <dir>".
 *
 * The resume section never touches the list: absent is one quiet line, and
 * unreadable is an alarm banner above records drawn exactly as before.
 *
 * ## The states that must never become an empty list
 *
 * The server says why there is nothing (`absent`, `unreadable`,
 * `unsupported-schema`, `oversized`), and this page gives each its own
 * sentence. Inside a published index, four more facts get banners at the top
 * rather than being folded into the rows: the daemon has not checked the records
 * yet; the inventory it checked against cannot be trusted (drawn **once**, so
 * every `unknown` row is not wearing the same sentence); the one-time replay of
 * an old log did not run; and candidates past the capacity exist only in the
 * journal.
 *
 * ## The server's order, not ours
 *
 * Rows arrive grouped, interrupted first, newest disappearance first — the
 * feed's projection. This component inserts a subheading when the group
 * changes and does not sort, for DecisionsPanel's reason: a second ordering rule
 * in the browser would let two readers of one index disagree.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  httpRecoveryApi,
  httpRecoveryResumeApi,
  type RecoveryApi,
  type RecoveryResumeApi,
  type RecoveryView,
  type ResumePostView,
} from "./recovery-client";
import { Button, Card, Mono, Pill, SectionHeading, cx, toneClasses } from "./ui";
import { formatDuration, type Tone } from "./view";
import type {
  RecoveryFeed,
  RecoveryResumeAccount,
  RecoveryResumePreview,
  RecoveryResumeQuote,
  RecoveryResumeRequestState,
  RecoveryResumeSection,
  RecoveryResumeVerification,
  RecoveryWireEvidence,
  RecoveryWireLiveRow,
  RecoveryWireRecord,
  RecoveryWireRecordState,
  RecoveryWireTranscript,
} from "../../wire";

/** No faster than this, and only while mounted: the index changes when the daemon writes it, which is not often. */
export const RECOVERY_POLL_MS = 60_000;

type Published = Extract<RecoveryFeed, { kind: "published" }>;
type PanelView = RecoveryView | { kind: "loading" };

type Group = { label: string; tone: Tone };

function groupOf(state: RecoveryWireRecordState): Group {
  switch (state.kind) {
    case "resolved":
      return { label: "Resolved", tone: "idle" };
    case "unchecked":
      return { label: "Not yet checked", tone: "unknown" };
    case "classified":
      switch (state.classification.kind) {
        case "interrupted":
          return { label: "Interrupted", tone: "needs" };
        case "present-but-unmatched":
          return { label: "Present but unmatched", tone: "unknown" };
        case "unknown":
          return { label: "Unknown", tone: "unknown" };
        case "ended-before-reboot":
          return { label: "Stopped before the world change", tone: "idle" };
        case "already-live":
          return { label: "Already live", tone: "work" };
        default: {
          const never: never = state.classification;
          return never;
        }
      }
    default: {
      const never: never = state;
      return never;
    }
  }
}

/** An age in words, or null — never "0s" standing in for a clock this page cannot read. */
function ageOf(at: string, nowMs: number): string | null {
  const parsed = Date.parse(at);
  if (!Number.isFinite(parsed) || !Number.isFinite(nowMs) || nowMs - parsed < 0) return null;
  return formatDuration(nowMs - parsed);
}

function When({ at }: { at: string }): ReactNode {
  return <time dateTime={at}>{at}</time>;
}

/** A path, which must break anywhere on a phone: it has no spaces to wrap at. */
function PathText({ path }: { path: string }): ReactNode {
  return <span className="tw:font-mono tw:text-[12px] tw:break-all tw:text-ink">{path}</span>;
}

function Fact({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="tw:col-span-2 tw:grid tw:grid-cols-subgrid">
      <dt className="tw:text-ink-faint">{label}</dt>
      <dd className="tw:min-w-0 tw:break-words tw:text-ink-soft">{children}</dd>
    </div>
  );
}

function Banner({ tone, head, children, testId }: { tone: Tone; head: string; children?: ReactNode; testId: string }): ReactNode {
  return (
    <Card className={cx("tw:mb-2 tw:border-l-4 tw:p-3", toneClasses(tone).edge, toneClasses(tone).wash)}>
      <div data-testid={testId}>
        <p className={cx("tw:text-[13px] tw:font-semibold", toneClasses(tone).ink)}>{head}</p>
        {children === undefined ? null : <div className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">{children}</div>}
      </div>
    </Card>
  );
}

function transcriptFact(t: RecoveryWireTranscript): ReactNode {
  switch (t.kind) {
    case "found":
      return (
        <>
          found, for its verified conversation <Mono>{t.conversationId}</Mono>: <PathText path={t.path} />
        </>
      );
    case "found-under-claim":
      return (
        <>
          <Pill tone="unknown">unverified</Pill> found under the session's claim <Mono>{t.claimedConversationId}</Mono>, not under a
          verified conversation: <PathText path={t.path} />. {t.why}
        </>
      );
    case "not-found":
      return (
        <>
          not found, looked for under the {t.under === "verified" ? "verified conversation" : "claim"} <Mono>{t.conversationId}</Mono>:{" "}
          {t.why}
        </>
      );
    case "cannot-tell":
      return (
        <>
          <Pill tone="unknown">cannot tell</Pill> looked for under the {t.under === "verified" ? "verified conversation" : "claim"}{" "}
          <Mono>{t.conversationId}</Mono>: {t.why}
        </>
      );
    case "no-conversation":
      return <>none to look for: {t.why}</>;
    default: {
      const never: never = t;
      return never;
    }
  }
}

function EvidenceFacts({ evidence }: { evidence: RecoveryWireEvidence }): ReactNode {
  if (evidence.kind === "unavailable") return <Fact label="evidence">{evidence.why}</Fact>;
  const { dir, worktree, transcript, lastActivity, resume } = evidence;
  return (
    <>
      <Fact label="directory">
        {dir.kind === "exists" ? (
          <>
            <PathText path={dir.path} /> — exists
          </>
        ) : dir.kind === "missing" ? (
          <>
            <PathText path={dir.path} /> — <span className="tw:font-semibold tw:text-needs-ink">missing</span>: {dir.why}
          </>
        ) : dir.kind === "cannot-tell" ? (
          <>
            <PathText path={dir.path} /> — cannot tell whether it exists: {dir.why}
          </>
        ) : (
          <>not recorded: {dir.why}</>
        )}
      </Fact>
      {worktree.kind === "none" ? null : (
        <Fact label="worktree">
          <Mono>{worktree.name}</Mono>
          {worktree.kind === "recorded" ? " — the directory above is inside it" : ` — ${worktree.why}`}
        </Fact>
      )}
      <Fact label="transcript">{transcriptFact(transcript)}</Fact>
      <Fact label="last activity">
        {lastActivity.source === "transcript" ? (
          <>
            <When at={lastActivity.at} /> (the transcript's last write)
          </>
        ) : (
          <>
            ≥ <When at={lastActivity.at} /> (a floor: alive at least this recently)
          </>
        )}
      </Fact>
      <Fact label="resume">
        {resume.kind === "supported"
          ? "supported: its verified conversation's transcript was found."
          : resume.kind === "not-supported"
            ? `not supported: ${resume.why}`
            : `manual: ${resume.why}`}
      </Fact>
      {resume.kind === "manual" ? (
        <Fact label="where to look">
          on <Mono>{resume.host}</Mono>, in {resume.dir === null ? "no recorded directory" : <PathText path={resume.dir} />}
        </Fact>
      ) : null}
    </>
  );
}

/**
 * The live row a record was matched against, or only resembles — **with the
 * four facts the match turns on** (Sol's F32): its directory, the conversation
 * its session claims, the conversation it was verified to be running, and its
 * execution token. Without them "present but unmatched" is a verdict nobody can
 * check. Each says so when it is absent rather than being left out.
 */
function LiveRowFacts({ row }: { row: RecoveryWireLiveRow }): ReactNode {
  return (
    <>
      <Fact label="live row">
        <Mono>{row.name}</Mono> ({row.tmuxId}), {row.statusKey}
      </Fact>
      <Fact label="live directory">{row.dir === null ? "not recorded" : <PathText path={row.dir} />}</Fact>
      <Fact label="live claim">
        {row.claimedConversationId === null ? (
          "none"
        ) : (
          <>
            <Mono>{row.claimedConversationId}</Mono> (the session's claim, unverified)
          </>
        )}
      </Fact>
      <Fact label="live conversation">
        {row.conversationId === null ? (
          "not verified"
        ) : (
          <>
            <Mono>{row.conversationId}</Mono> (verified)
          </>
        )}
      </Fact>
      <Fact label="live run">{row.executionToken === null ? "not verified" : <Mono>{row.executionToken}</Mono>}</Fact>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Resume (plan 260910f, Stage 2): the page's one control.
 * ------------------------------------------------------------------ */

/**
 * A Claude conversation id, strictly: lowercase and hyphenated, with nothing
 * before or after it. **The only id manual instructions are ever built from**;
 * anything else — a claim, an uppercase copy, a uuid with a flag glued on — gets
 * no instructions at all.
 */
export const STRICT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Characters a POSIX shell reads as one plain word, unquoted. */
const SHELL_PLAIN = /^[A-Za-z0-9_./:@%+=,-]+$/;

function hasControlCharacter(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 32 || c === 127) return true;
  }
  return false;
}

/** One POSIX shell word: as it is when plain, otherwise single-quoted, each inner quote closed, escaped and reopened. */
export function shellQuote(word: string): string {
  return SHELL_PLAIN.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/**
 * The lines to type on the box, or null when any input fails its check —
 * never a command built from something unchecked. With a pinned account the
 * resume runs under that account's config directory (`--resume` finds only its
 * own config directory's conversations, plan G4); without one it is the plain
 * command, and the page says why beside it.
 */
export function manualResumeCommand(input: { conversationId: string; dir: string | null; configDir: string | null }): string | null {
  const { conversationId, dir, configDir } = input;
  if (!STRICT_UUID.test(conversationId)) return null;
  for (const path of [dir, configDir]) {
    if (path !== null && (!path.startsWith("/") || hasControlCharacter(path))) return null;
  }
  const lines = ["gjd-remote ssh"];
  if (dir !== null) lines.push(`cd ${shellQuote(dir)}`);
  lines.push(`${configDir === null ? "" : `CLAUDE_CONFIG_DIR=${shellQuote(configDir)} `}claude --resume ${conversationId}`);
  return lines.join("\n");
}

/** The conversation the evidence verified, never a claim. */
function verifiedConversation(t: RecoveryWireTranscript): string | null {
  switch (t.kind) {
    case "found":
      return t.conversationId;
    case "not-found":
    case "cannot-tell":
      return t.under === "verified" ? t.conversationId : null;
    case "found-under-claim":
    case "no-conversation":
      return null;
    default: {
      const never: never = t;
      return never;
    }
  }
}

function existingDir(evidence: Extract<RecoveryWireEvidence, { kind: "checked" }>): string | null {
  return evidence.dir.kind === "exists" ? evidence.dir.path : null;
}

/** What the rows need from the resume section, handed down once. */
type ResumeContext = {
  section: RecoveryResumeSection;
  /** The view's `checkedAt`: what "seen" means when the person taps. Null when the view is not checked. */
  checkedAt: string | null;
  api: RecoveryResumeApi;
  /** Read the index again, so a queued request shows its state without waiting for the poll. */
  onPosted(): void;
};

type Pinned = Extract<RecoveryResumeAccount, { kind: "pinned" }>;

/** Whether this page can resume the record, and with what — or, in words, why not. */
function resumability(ctx: ResumeContext, preview: RecoveryResumePreview | undefined): { kind: "yes"; preview: RecoveryResumePreview; account: Pinned; checkedAt: string } | { kind: "no"; why: string } {
  switch (ctx.section.kind) {
    case "absent":
      return { kind: "no", why: "resume is not available from this dashboard yet" };
    case "unreadable":
    case "unsupported-schema":
      return { kind: "no", why: "the resume data could not be read (see above)" };
    case "published":
      break;
    default: {
      const never: never = ctx.section;
      return never;
    }
  }
  if (ctx.section.projection.launcher.kind === "unwired") return { kind: "no", why: ctx.section.projection.launcher.why };
  if (preview === undefined) return { kind: "no", why: "the Overseer has written no preview of it, so there is nothing to confirm against" };
  if (preview.account.kind === "unknown") return { kind: "no", why: preview.account.why };
  if (ctx.checkedAt === null) return { kind: "no", why: "the daemon's view has not checked it" };
  return { kind: "yes", preview, account: preview.account, checkedAt: ctx.checkedAt };
}

function ManualInstructions({
  conversationId,
  dir,
  account,
  whyNot,
}: {
  conversationId: string;
  dir: string | null;
  account: RecoveryResumeAccount | null;
  whyNot: string;
}): ReactNode {
  const command = manualResumeCommand({ conversationId, dir, configDir: account?.kind === "pinned" ? account.configDir : null });
  if (command === null) return null;
  return (
    <div data-testid="recovery-resume-manual" className="tw:mt-2 tw:min-w-0 tw:text-[12px] tw:text-ink-soft">
      <p data-testid="recovery-resume-why-not">This page cannot resume it: {whyNot}.</p>
      <p className="tw:mt-1">To resume it by hand, on the box:</p>
      <pre className="tw:mt-1 tw:rounded-md tw:border tw:border-rule tw:p-2 tw:whitespace-pre-wrap tw:break-all">
        <code data-testid="recovery-resume-manual-command" className="tw:font-mono tw:text-[12px] tw:text-ink">
          {command}
        </code>
      </pre>
      {account === null ? (
        <p className="tw:mt-1">
          Run it under the account whose config directory holds this conversation's transcript: set <Mono>CLAUDE_CONFIG_DIR</Mono> to that directory, or
          leave it unset for the default login. This page does not know which account that is.
        </p>
      ) : null}
    </div>
  );
}

const VERIFICATION_PARTS: [keyof RecoveryResumeVerification, string][] = [
  ["inventoryResumed", "the inventory sees it resumed"],
  ["observedRunning", "the launch was seen running"],
  ["transcriptGrew", "its transcript has grown since the launch"],
  ["sessionLineSeen", "a new line from this conversation was written"],
];

function RequestStateLine({ state }: { state: RecoveryResumeRequestState }): ReactNode {
  let body: ReactNode;
  switch (state.kind) {
    case "pending":
      body = (
        <>
          Queued{state.actor === "cli" ? " from the CLI" : ""}, position {state.position}, since <When at={state.requestedAt} />. Waiting: {state.why}
          {state.until === null ? null : (
            <>
              {" "}
              — until <When at={state.until} />
            </>
          )}
          .
        </>
      );
      break;
    case "refused":
      body = (
        <>
          Refused at <When at={state.refusedAt} />: {state.why}. You can ask again once that is fixed.
        </>
      );
      break;
    case "launched":
      body = (
        <>
          Started as <Mono>{state.launch.occurrenceId}</Mono> ({state.launch.state}), not yet verified running: waiting for {state.waitingFor}.
          <ul className="tw:mt-1">
            {VERIFICATION_PARTS.map(([part, label]) => (
              <li key={part} data-ok={String(state.verification[part])}>
                {state.verification[part] ? "✓" : "✗"} {label}
              </li>
            ))}
          </ul>
        </>
      );
      break;
    case "ended-unverified":
      body = <>Ended before it was seen running: {state.how}.</>;
      break;
    case "needs-greg":
      body = (
        <>
          Needs you: {state.why}. Only a dispose ends it:{" "}
          <code className="tw:font-mono tw:text-[12px] tw:break-all tw:text-ink">{state.disposeCommand}</code>
        </>
      );
      break;
    case "disposed":
      body = (
        <>
          Its launch, <Mono>{state.launch.occurrenceId}</Mono>, was disposed. Nothing more happens to this request.
        </>
      );
      break;
    case "resumed":
      body = (
        <>
          Resumed, and verified running at <When at={state.verifiedAt} />
          {state.launch === null ? null : (
            <>
              {" "}
              (launch <Mono>{state.launch.occurrenceId}</Mono>)
            </>
          )}
          .
        </>
      );
      break;
    default: {
      const never: never = state;
      return never;
    }
  }
  return (
    <div data-testid="recovery-resume-state" data-kind={state.kind} className="tw:mt-2 tw:min-w-0 tw:break-words tw:text-[12px] tw:text-ink">
      <span className="tw:font-semibold">Resume: </span>
      {body}
    </div>
  );
}

function Quotation({ testId, label, quote }: { testId: string; label: string; quote: RecoveryResumeQuote }): ReactNode {
  return (
    <div data-testid={testId} className="tw:mt-2">
      <p className="tw:text-ink-faint">
        {label}
        {quote.kind === "quoted" && quote.truncated ? " (truncated)" : ""}
      </p>
      {quote.kind === "quoted" ? (
        <blockquote className="tw:mt-1 tw:border-l-2 tw:border-rule tw:pl-2 tw:break-words tw:whitespace-pre-wrap tw:text-ink-soft">{quote.text}</blockquote>
      ) : (
        <p className="tw:mt-1 tw:text-ink-soft">not available: {quote.why}</p>
      )}
    </div>
  );
}

function outcomeText(view: ResumePostView): string {
  if (view.kind === "no-answer") return `No answer from the dashboard (${view.why}). It may still have been queued: the next refresh shows whether it was.`;
  const answer = view.answer;
  if (!answer.ok) return `Not queued: ${answer.why}`;
  switch (answer.outcome) {
    case "queued":
      return "Queued. The Overseer takes it on its next pass, after checking the box, the quota and this session's evidence; this card shows how it goes.";
    case "already-requested":
      return "Already requested: this session is already waiting in the queue, so nothing new was queued.";
    case "already-launched":
      return "Already launched: the Overseer has started this session once already, so nothing new was queued.";
    default: {
      const never: never = answer.outcome;
      return never;
    }
  }
}

function ResumeConfirm({
  recordId,
  preview,
  account,
  checkedAt,
  ctx,
  onCancel,
}: {
  recordId: string;
  preview: RecoveryResumePreview;
  account: Pinned;
  checkedAt: string;
  ctx: ResumeContext;
  onCancel(): void;
}): ReactNode {
  const [inFlight, setInFlight] = useState(false);
  const [outcome, setOutcome] = useState<ResumePostView | null>(null);
  // A ref as well as the state, so a second tap in the same frame cannot post twice.
  const flying = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const submit = (): void => {
    if (flying.current) return;
    flying.current = true;
    setInFlight(true);
    const body = { candidateId: recordId, seen: { checkedAt, conversationId: preview.conversationId, dir: preview.dir } };
    void Promise.resolve()
      .then(() => ctx.api.post(body))
      .catch((cause: unknown): ResumePostView => ({ kind: "no-answer", why: String(cause) }))
      .then((view) => {
        flying.current = false;
        if (!live.current) return;
        setOutcome(view);
        setInFlight(false);
        ctx.onPosted();
      });
  };
  return (
    <div data-testid="recovery-resume-confirm" className="tw:mt-2 tw:min-w-0 tw:rounded-md tw:border tw:border-rule tw:p-3 tw:text-[12px]">
      <p className="tw:text-[13px] tw:font-semibold tw:break-words tw:text-ink">
        Resume {preview.title === null ? "this session" : <>“{preview.title}”</>}?
      </p>
      <Quotation testId="recovery-resume-brief" label="What it was asked to do, quoted from its transcript" quote={preview.brief} />
      <Quotation testId="recovery-resume-last-words" label="Where it got to, quoted from its transcript" quote={preview.lastWords} />
      <div className="tw:mt-2">
        <p className="tw:text-ink-faint">What we cannot be sure of</p>
        <ul data-testid="recovery-resume-uncertainty" className="tw:mt-1 tw:list-disc tw:pl-4 tw:text-ink-soft">
          {preview.uncertainty.map((sentence) => (
            <li key={sentence} className="tw:break-words">
              {sentence}
            </li>
          ))}
        </ul>
      </div>
      <p data-testid="recovery-resume-account" className="tw:mt-2 tw:text-ink">
        Runs under account <Mono>{account.name}</Mono>
      </p>
      <div className="tw:mt-2">
        <p className="tw:text-ink-faint">The nudge that will be typed first, exactly</p>
        <pre data-testid="recovery-resume-nudge" className="tw:mt-1 tw:rounded-md tw:border tw:border-rule tw:p-2 tw:font-mono tw:text-[12px] tw:break-words tw:whitespace-pre-wrap tw:text-ink">
          {preview.nudge}
        </pre>
      </div>
      <p data-testid="recovery-resume-dir" className="tw:mt-2 tw:text-ink-soft">
        In <PathText path={preview.dir} />
      </p>
      <p className="tw:mt-2 tw:text-ink">Starts one session. Any others you pick wait until this one is verified running.</p>
      <div className="tw:mt-2 tw:flex tw:flex-wrap tw:gap-2">
        <Button variant="loud" data-testid="recovery-resume-submit" disabled={inFlight} onClick={submit}>
          Resume this session
        </Button>
        <Button data-testid="recovery-resume-cancel" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {outcome === null ? null : (
        <p data-testid="recovery-resume-outcome" role="status" className="tw:mt-2 tw:break-words tw:text-ink">
          {outcomeText(outcome)}
        </p>
      )}
    </div>
  );
}

/**
 * The resume part of one card: its request's state, and then Resume…, manual
 * instructions, or nothing.
 */
function ResumeBlock({ record, ctx }: { record: RecoveryWireRecord; ctx: ResumeContext }): ReactNode {
  const [open, setOpen] = useState(false);
  const projection = ctx.section.kind === "published" ? ctx.section.projection : null;
  const request = projection?.requests.find((r) => r.candidateId === record.id);
  const preview = projection?.previews.find((p) => p.candidateId === record.id);
  const stateLine = request === undefined ? null : <RequestStateLine state={request.state} />;
  const s = record.state;
  // NO CONTROL OF ANY KIND on anything but interrupted: unknown,
  // present-but-unmatched and ended-before-reboot stay visible and untouched.
  if (s.kind !== "classified" || s.classification.kind !== "interrupted" || s.evidence.kind !== "checked") return stateLine;
  const evidence = s.evidence;
  const resume = evidence.resume;
  switch (resume.kind) {
    case "manual":
      // Today's "on <host>, in <dir>", drawn with the evidence.
      return stateLine;
    case "not-supported": {
      const conversation = verifiedConversation(evidence.transcript);
      return (
        <>
          {stateLine}
          {conversation === null ? null : <ManualInstructions conversationId={conversation} dir={existingDir(evidence)} account={null} whyNot={resume.why} />}
        </>
      );
    }
    case "supported":
      break;
    default: {
      const never: never = resume;
      return never;
    }
  }
  // A request in flight or settled is shown, not offered again — except a refusal.
  if (request !== undefined && request.state.kind !== "refused") return stateLine;
  const can = resumability(ctx, preview);
  if (can.kind === "no") {
    return (
      <>
        {stateLine}
        <ManualInstructions conversationId={resume.conversationId} dir={preview?.dir ?? existingDir(evidence)} account={preview?.account ?? null} whyNot={can.why} />
      </>
    );
  }
  return (
    <>
      {stateLine}
      {open ? (
        <ResumeConfirm recordId={record.id} preview={can.preview} account={can.account} checkedAt={can.checkedAt} ctx={ctx} onCancel={() => setOpen(false)} />
      ) : (
        <div className="tw:mt-2">
          <Button data-testid="recovery-resume-open" onClick={() => setOpen(true)}>
            Resume…
          </Button>
        </div>
      )}
    </>
  );
}

function RecordCard({ record, untrusted, resume }: { record: RecoveryWireRecord; untrusted: boolean; resume: ResumeContext }): ReactNode {
  const group = groupOf(record.state);
  const state = record.state;
  let why: string;
  let pill: string;
  switch (state.kind) {
    case "resolved":
      pill = state.resolution.disposition;
      why =
        state.resolution.disposition === "resumed"
          ? `resumed: its verified conversation ${state.resolution.evidence.conversationId} is live under a different run (${state.resolution.evidence.previousToken} → ${state.resolution.evidence.token})`
          : state.resolution.disposition === "superseded"
            ? `superseded by a newer record, ${state.resolution.evidence.by}`
            : `dismissed: “${state.resolution.evidence.why}”`;
      break;
    case "unchecked":
      pill = "not checked";
      why = state.why;
      break;
    case "classified":
      pill = state.classification.kind;
      // THE INVENTORY-TRUST SENTENCE IS THE BANNER'S, drawn once above. Every
      // row it makes unknown says so in five words rather than repeating it.
      why =
        untrusted && state.classification.kind === "unknown"
          ? "unknown: the current inventory cannot be trusted (see above)"
          : state.classification.why;
      break;
    default: {
      const never: never = state;
      return never;
    }
  }
  const gone = record.disappearance;
  return (
    <Card className={cx("tw:mb-2 tw:border-l-4 tw:p-3", toneClasses(group.tone).edge)}>
      <div data-testid="recovery-record" data-state={state.kind === "classified" ? state.classification.kind : state.kind}>
        <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          <Pill tone={group.tone}>{pill}</Pill>
          {record.origin === "legacy" ? <Pill tone="idle">from an old log</Pill> : null}
          <span className="tw:min-w-0 tw:text-[13px] tw:font-semibold tw:break-all tw:text-ink">{record.name}</span>
        </div>
        <p className="tw:mt-1 tw:text-[12px] tw:break-words tw:text-ink-soft">{why}</p>
        <dl className="tw:mt-2 tw:grid tw:grid-cols-[auto_1fr] tw:gap-x-3 tw:gap-y-1 tw:text-[12px]">
          <Fact label="disappeared">
            <When at={record.at} />
            {gone === null
              ? null
              : ` — ${gone.goneWhy}; ${gone.watched ? "the daemon watched it go" : "nobody watched it go"}${gone.bootChanged ? "; the host's boot id changed" : ""}`}
          </Fact>
          {record.oversize ? <Fact label="record">too large for the index; the full candidate is in events.jsonl</Fact> : null}
          {state.kind === "classified" && (state.classification.kind === "already-live" || state.classification.kind === "present-but-unmatched") ? (
            <LiveRowFacts row={state.classification.row} />
          ) : null}
          {state.kind === "classified" ? (
            <EvidenceFacts evidence={state.evidence} />
          ) : (
            <>
              {record.entry === null ? null : (
                <>
                  <Fact label="directory">
                    {record.entry.dir === null ? (
                      "not recorded"
                    ) : (
                      <>
                        <PathText path={record.entry.dir} /> — whether it exists was not checked
                      </>
                    )}
                  </Fact>
                  {/* THE STORED WORKTREE, AS RECORDED (Sol's F32): a name, unchecked. */}
                  <Fact label="worktree">{record.entry.worktree === null ? "none recorded" : <Mono>{record.entry.worktree}</Mono>}</Fact>
                  <Fact label="transcript">not checked</Fact>
                  <Fact label="last activity">
                    ≥ <When at={record.entry.lastSeenAlive} /> (a floor: alive at least this recently)
                  </Fact>
                </>
              )}
              <Fact label="resume">{state.kind === "resolved" ? "not applicable, this record is resolved" : "not checked"}</Fact>
            </>
          )}
          <Fact label="latest evidence">
            {record.lastSeen !== null ? (
              <>
                last seen <Mono>{record.lastSeen.statusKey}</Mono>, harness {record.lastSeen.harness ?? "not verified"}, at{" "}
                <When at={record.lastSeen.collectedAt} />
                {record.lastSeen.title === null ? null : <> — “{record.lastSeen.title}”</>}
              </>
            ) : record.entry !== null ? (
              <>
                no watched sighting; the register last recorded <Mono>{record.entry.lastStatusKey}</Mono>
              </>
            ) : (
              "no sighting survives"
            )}
          </Fact>
          {state.kind === "resolved" ? (
            <Fact label="resolved">
              <When at={state.resolution.at} />
            </Fact>
          ) : null}
        </dl>
        <ResumeBlock record={record} ctx={resume} />
      </div>
    </Card>
  );
}

/** Above the list: the resume section's own state, never folded into the rows. */
function ResumeHead({ section }: { section: RecoveryResumeSection }): ReactNode {
  switch (section.kind) {
    case "absent":
      return (
        <p data-testid="recovery-resume-absent" className="tw:mb-2 tw:px-1 tw:text-[12px] tw:text-ink-faint">
          Resume is not available from this dashboard yet.
        </p>
      );
    case "unreadable":
    case "unsupported-schema":
      return (
        <Banner tone="alarm" head="The resume data in the index could not be read, so this page offers no Resume." testId="recovery-resume-banner">
          {section.why}. The records below are shown as they are.
        </Banner>
      );
    case "published": {
      const pace = section.projection.pace;
      if (pace.kind === "waiting-for-verification") {
        return (
          <p data-testid="recovery-pace" className="tw:mb-2 tw:px-1 tw:text-[12px] tw:break-words tw:text-ink">
            Waiting for <span className="tw:font-semibold">{pace.name}</span> to be verified running before the next resume starts (since{" "}
            <When at={pace.since} />
            ).
          </p>
        );
      }
      if (pace.kind === "spacing") {
        return (
          <p data-testid="recovery-pace" className="tw:mb-2 tw:px-1 tw:text-[12px] tw:text-ink-soft">
            The next resume waits until <When at={pace.until} />, so the last one's start-up load lands first.
          </p>
        );
      }
      return null;
    }
    default: {
      const never: never = section;
      return never;
    }
  }
}

function PublishedView({
  feed,
  nowMs,
  receivedAtMs,
  resumeApi,
  onPosted,
}: {
  feed: Published;
  nowMs: number;
  receivedAtMs: number;
  resumeApi: RecoveryResumeApi;
  onPosted(): void;
}): ReactNode {
  const view = feed.view;
  const resume: ResumeContext = { section: feed.resume, checkedAt: view.kind === "checked" ? view.checkedAt : null, api: resumeApi, onPosted };
  const untrusted = view.kind === "checked" && view.inventory.kind === "untrusted";
  // THE AGE IS THE SERVER'S (Sol's F31). `checkedAt` is the box's clock; a
  // phone's can be minutes out, and measuring one against the other said
  // "checked 0s ago" of a view the server already knew was half an hour old.
  // So it is measured against `composedAt`, the server's clock when it
  // answered, advanced by how long this page has held the answer — an interval
  // on this page's clock, which is the one thing that clock can measure.
  const serverNowMs = Date.parse(feed.composedAt) + Math.max(0, nowMs - receivedAtMs);
  const age = view.kind === "checked" ? ageOf(view.checkedAt, serverNowMs) : null;
  // THE PLAIN EMPTY STATE ONLY FOR A TRULY EMPTY INDEX (Sol's F33). Beside an
  // overflow, or a replay that did not run, "no interrupted work is recorded"
  // contradicts the banner above it: there is work recorded, just not here.
  const trulyEmpty = feed.total === 0 && feed.overflow === 0 && feed.replay.kind === "ran";
  let lastGroup: string | null = null;
  return (
    <div>
      {view.kind === "not-yet-checked" ? (
        <Banner tone="unknown" head="Not yet checked by this daemon." testId="recovery-banner-unchecked">
          {view.why}. The records below are the ones it holds; their classification is unknown until then.
        </Banner>
      ) : view.kind === "unreadable" ? (
        <Banner tone="alarm" head="The daemon's view of these records could not be read." testId="recovery-banner-view-unreadable">
          {view.why}. The records are shown unchecked.
        </Banner>
      ) : view.inventory.kind === "untrusted" ? (
        <Banner tone="unknown" head="The inventory cannot be trusted right now, so every record is unknown." testId="recovery-banner-untrusted">
          {view.inventory.why}
        </Banner>
      ) : null}
      {feed.replay.kind === "not-run" ? (
        <Banner tone="alarm" head="The one-time replay of the log did not run." testId="recovery-banner-replay">
          {feed.replay.why}. Work interrupted before this index existed may be missing from it.
        </Banner>
      ) : null}
      {feed.overflow > 0 ? (
        <Banner
          tone="alarm"
          head={`${feed.overflow} ${feed.overflow === 1 ? "candidate is" : "candidates are"} past the index's capacity and not listed.`}
          testId="recovery-banner-overflow"
        >
          Those events survive only in <Mono>events.jsonl</Mono>; neither this page nor the CLI lists them.
        </Banner>
      ) : null}
      <ResumeHead section={feed.resume} />

      <p data-testid="recovery-age" className="tw:mb-2 tw:px-1 tw:text-[12px] tw:text-ink-faint">
        {view.kind === "checked" ? (
          <>
            {age === null ? (
              <>
                Checked at <When at={view.checkedAt} /> (how long ago cannot be read from the server's clock)
              </>
            ) : (
              <>
                Checked {age} ago by the server's clock, at <When at={view.checkedAt} />
              </>
            )}
            {view.inventory.kind === "trusted" ? (
              <>
                , against the inventory collected at <When at={view.inventory.collectedAt} /> ({view.inventory.rows}{" "}
                {view.inventory.rows === 1 ? "session" : "sessions"})
              </>
            ) : null}
            .{" "}
          </>
        ) : null}
        {feed.unresolved} unresolved of {feed.total} {feed.total === 1 ? "record" : "records"}.
        {feed.writtenAt === null ? null : (
          <>
            {" "}
            Index written <When at={feed.writtenAt} />.
          </>
        )}
      </p>

      {feed.records.length === 0 ? (
        trulyEmpty ? (
          <Card className="tw:p-3">
            <p data-testid="recovery-empty" className="tw:text-[13px] tw:text-ink">
              No interrupted work is recorded.
            </p>
            <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">The index was read, and it holds no records.</p>
          </Card>
        ) : (
          <Card className="tw:p-3">
            <p data-testid="recovery-empty" className="tw:text-[13px] tw:text-ink">
              The recovery index currently holds no records.
            </p>
          </Card>
        )
      ) : (
        feed.records.map((record) => {
          const group = groupOf(record.state).label;
          const heading = group === lastGroup ? null : <h3 className="tw:px-1 tw:pt-2 tw:pb-1 tw:text-[12px] tw:font-semibold tw:text-ink-soft">{group}</h3>;
          lastGroup = group;
          return (
            <div key={record.id}>
              {heading}
              <RecordCard record={record} untrusted={untrusted} resume={resume} />
            </div>
          );
        })
      )}

      {feed.olderCount > 0 ? (
        <p className="tw:mt-2 tw:px-1 tw:text-[12px] tw:text-ink-faint">
          {feed.olderCount} older {feed.olderCount === 1 ? "record is" : "records are"} not shown here; the recovery CLI's list shows every
          record the index holds.
        </p>
      ) : null}
      {feed.replay.kind === "ran" ? (
        <p className="tw:mt-2 tw:px-1 tw:text-[11px] tw:text-ink-faint">
          The old log was scanned once: {feed.replay.worldChanges} world {feed.replay.worldChanges === 1 ? "change" : "changes"},{" "}
          {feed.replay.derived} {feed.replay.derived === 1 ? "record" : "records"} derived.
        </p>
      ) : null}
    </div>
  );
}

function Body({
  view,
  nowMs,
  receivedAtMs,
  resumeApi,
  onPosted,
}: {
  view: PanelView;
  nowMs: number;
  receivedAtMs: number;
  resumeApi: RecoveryResumeApi;
  onPosted(): void;
}): ReactNode {
  switch (view.kind) {
    case "loading":
      return <p className="tw:p-3 tw:text-[13px] tw:text-ink-faint">Reading the recovery index…</p>;
    case "no-answer":
      return (
        <Banner tone="unknown" head="This browser did not get an answer from the recovery API." testId="recovery-no-answer">
          {view.why}
        </Banner>
      );
    case "absent":
      return (
        <Banner tone="idle" head="No recovery index has been written here yet." testId="recovery-absent">
          {view.why} <PathText path={view.path} />
        </Banner>
      );
    case "unreadable":
      return (
        <Banner tone="alarm" head="The recovery index could not be read." testId="recovery-unreadable">
          {view.why}
          <p className="tw:mt-1">This is not an empty list: interrupted work could be hidden.</p>
        </Banner>
      );
    case "unsupported-schema":
      return (
        <Banner tone="alarm" head="The recovery index is in a format this dashboard cannot read." testId="recovery-unsupported">
          {view.why}
        </Banner>
      );
    case "oversized":
      return (
        <Banner tone="alarm" head="The recovery index is too large for this page." testId="recovery-oversized">
          {view.why}
        </Banner>
      );
    case "published":
      return <PublishedView feed={view} nowMs={nowMs} receivedAtMs={receivedAtMs} resumeApi={resumeApi} onPosted={onPosted} />;
    default: {
      const never: never = view;
      return never;
    }
  }
}

export function RecoveryPanel({
  api = httpRecoveryApi,
  resumeApi = httpRecoveryResumeApi,
  refreshNonce = 0,
  nowMs,
}: {
  api?: RecoveryApi;
  /** The one control's POST. */
  resumeApi?: RecoveryResumeApi;
  /** Bumped by the dock's Refresh. */
  refreshNonce?: number;
  /** The page's ticking clock, for the view's age. */
  nowMs?: number;
}): ReactNode {
  // The current poll's loader, so a POST can read the index again at once.
  const reload = useRef<() => void>(() => {});
  const onPosted = useCallback(() => reload.current(), []);
  // The answer, and when this page got it on the page's own clock: the view's
  // age is the server's clock advanced by the interval since (F31).
  const [held, setHeld] = useState<{ view: PanelView; receivedAtMs: number }>({ view: { kind: "loading" }, receivedAtMs: 0 });
  const pageClock = useRef(nowMs);
  useEffect(() => {
    pageClock.current = nowMs;
  }, [nowMs]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshNonce is the refresh signal.
  useEffect(() => {
    let current: AbortController | null = null;
    let live = true;
    const load = (): void => {
      current?.abort();
      const request = new AbortController();
      current = request;
      void api.fetch(request.signal).then((next) => {
        if (live && !request.signal.aborted) setHeld({ view: next, receivedAtMs: pageClock.current ?? Date.now() });
      });
    };
    reload.current = load;
    load();
    const timer = setInterval(load, RECOVERY_POLL_MS);
    return () => {
      live = false;
      reload.current = () => {};
      clearInterval(timer);
      current?.abort();
    };
  }, [api, refreshNonce]);

  return (
    <section aria-label="Interrupted work" data-testid="recovery-panel">
      <SectionHeading>Interrupted work</SectionHeading>
      <Body view={held.view} nowMs={nowMs ?? Date.now()} receivedAtMs={held.receivedAtMs} resumeApi={resumeApi} onPosted={onPosted} />
      {/* The plan's § 5 wording, exactly. */}
      <p data-testid="recovery-footer" className="tw:mt-3 tw:px-1 tw:text-[12px] tw:text-ink-faint">
        The one control here is <strong>Resume</strong>: it asks the Overseer to start that one interrupted Claude session again, after checking the
        box, the quota and the session's evidence. Others you pick wait their turn. Nothing resumes on its own, and nothing here dismisses anything.
      </p>
    </section>
  );
}
