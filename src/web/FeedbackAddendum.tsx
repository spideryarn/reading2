/**
 * **An addendum to one of the admin's own earlier reports** — the *Add to
 * this report* box under a report in the admin's Earlier tab, and the state
 * behind it.
 *
 * > Make it possible for me to add a reply as a kind of addendum to any earlier
 * > open feedback reports.
 * >
 * > — Greg, 2026-10-10 (`spya-saz0yw`)
 *
 * docs/plans/261010o-addendum-to-an-earlier-feedback-report.md. The box is
 * the reply box's (`FeedbackSendBox`), and the hook is the reply hook's shape
 * (FeedbackEarlier.tsx § `useQuestionReplies`), **keyed by report rather than
 * by question** (F5): each report's draft, the id its send carries, where its
 * send has got to, and what this page has added to it.
 */
import { useCallback, useRef, useState } from "react";

import { isSpideryarnId, mintId } from "../ids.js";
import {
  FEEDBACK_ADDENDUM_CLOSED,
  FEEDBACK_ADDENDUM_FAILED,
  FEEDBACK_ADDENDUM_FULL,
  FEEDBACK_ADDENDUM_STALE,
} from "../messages.js";
import { type AdminFeedbackAddendum, MAX_FEEDBACK_BODY_CHARS } from "../types.js";
import type { Receipt, ReplyStage } from "./FeedbackEarlier.js";
import { FeedbackSendBox } from "./FeedbackSendBox.js";
import { apiFetch } from "./lib/api.js";

const ADDENDA_PATH = "/api/admin/feedback/addenda";

/**
 * **The admin's addenda in progress**, held by the hook the dialog keeps
 * mounted, so a half-written addendum survives a look at another filter,
 * another tab, and the dialog being shut — for the life of the dialog, as a
 * half-written reply does.
 */
export interface ReportAddenda {
  /** The report whose box was opened last, or null. A box with words in it stays open whatever this says. */
  openId: string | null;
  /** What is typed so far for each report. */
  drafts: Readonly<Record<string, string>>;
  /** Where each report's send has got to. */
  stages: Readonly<Record<string, ReplyStage>>;
  /** Addenda sent from this page, per report, and when: shown at once, after the list's. */
  sent: Readonly<Record<string, Receipt<AdminFeedbackAddendum[]>>>;
  /** Whether anything unsent is held: words in a box, or a send in the air. */
  holds: boolean;
  open(report: string): void;
  /** Cancel: the box shuts and its words go. */
  cancel(report: string): void;
  setDraft(report: string, text: string): void;
  send(report: string): Promise<void>;
}

/**
 * **Words the admin wrote, as the server sends them back**: exactly an id,
 * the words, and a time that parses. An addendum, and a reply to a question
 * too (FeedbackEarlier.tsx § `isQuestionAnswer`), which has the same three.
 */
export function isAddendum(value: unknown): value is AdminFeedbackAddendum {
  if (typeof value !== "object" || value === null) return false;
  const one = value as Record<string, unknown>;
  return (
    Object.keys(one).sort().join() === "body,createdAt,id" &&
    typeof one.id === "string" && isSpideryarnId(one.id) &&
    typeof one.body === "string" && one.body.trim() !== "" &&
    typeof one.createdAt === "string" && !Number.isNaN(Date.parse(one.createdAt))
  );
}

/** An addendum POST's whole receipt: one stored addendum and nothing else. */
function isAddendumReceipt(value: unknown): value is { addendum: AdminFeedbackAddendum } {
  if (typeof value !== "object" || value === null) return false;
  const receipt = value as Record<string, unknown>;
  return Object.keys(receipt).join() === "addendum" && isAddendum(receipt.addendum);
}

/**
 * **Which sentence a refused send gets**, from the route's code: a 404 is a
 * server without the route, or without this report (reload); a 409 is the
 * report closed since the page loaded, the report full, or — `[fx-reused]`,
 * which a page that mints a new id for new words should never see — the
 * ordinary failure.
 */
async function refusal(res: Response): Promise<{ message: string; reused: boolean }> {
  if (res.status === 404) return { message: FEEDBACK_ADDENDUM_STALE.message, reused: false };
  if (res.status === 409) {
    const said = await res.text();
    if (said.includes("[fx-closed]")) return { message: FEEDBACK_ADDENDUM_CLOSED.message, reused: false };
    if (said.includes("[fx-full]")) return { message: FEEDBACK_ADDENDUM_FULL.message, reused: false };
    if (said.includes("[fx-reused]")) return { message: FEEDBACK_ADDENDUM_FAILED.message, reused: true };
  }
  return { message: FEEDBACK_ADDENDUM_FAILED.message, reused: false };
}

const IDLE: ReplyStage = { kind: "idle" };

/**
 * The addenda's state and the POST. **A send's id belongs to its report and
 * its words**, as a reply's does to its question: a retry of the same words
 * carries the same id, which the server answers with the stored row (200), and
 * edited words get a new id, so the server never sees one id with two bodies.
 *
 * `tick` is the Earlier hook's clock, so a receipt is retired only by a list
 * read that started after it landed (`addendaShown`).
 */
export function useReportAddenda(tick: () => number): ReportAddenda {
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [stages, setStages] = useState<Readonly<Record<string, ReplyStage>>>({});
  const [sent, setSent] = useState<Readonly<Record<string, Receipt<AdminFeedbackAddendum[]>>>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  /* Which reports have a send in the air: a ref too, since two presses in one frame both see the old render. */
  const sending = useRef(new Set<string>());
  const attempts = useRef(new Map<string, { body: string; id: string }>());

  const stage = useCallback(
    (report: string, next: ReplyStage) => setStages((all) => ({ ...all, [report]: next })),
    [],
  );
  const forget = useCallback(
    (report: string) =>
      setDrafts((all) => {
        const { [report]: _gone, ...rest } = all;
        return rest;
      }),
    [],
  );

  const open = useCallback((report: string) => {
    setOpenId(report);
    setStages((all) => ({ ...all, [report]: IDLE }));
  }, []);
  const cancel = useCallback((report: string) => {
    if (sending.current.has(report)) return;
    setOpenId((now) => (now === report ? null : now));
    forget(report);
    setStages((all) => ({ ...all, [report]: IDLE }));
  }, [forget]);
  const setDraft = useCallback((report: string, text: string) => {
    setDrafts((all) => ({ ...all, [report]: text }));
  }, []);

  const send = useCallback(
    async (report: string) => {
      const body = (draftsRef.current[report] ?? "").trim();
      if (sending.current.has(report) || body === "" || body.length > MAX_FEEDBACK_BODY_CHARS) return;
      const previous = attempts.current.get(report);
      const id = previous !== undefined && previous.body === body ? previous.id : mintId();
      attempts.current.set(report, { body, id });
      sending.current.add(report);
      stage(report, { kind: "sending" });
      let failed = FEEDBACK_ADDENDUM_FAILED.message;
      try {
        const res = await apiFetch(ADDENDA_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, report, body }),
        });
        if (res.ok) {
          /* 201, or 200 for a retry the server had already stored. Only a
             well-formed stored addendum for these words counts. */
          const receipt: unknown = await res.json();
          const added = isAddendumReceipt(receipt) ? receipt.addendum : null;
          if (added !== null && added.id === id && added.body === body) {
            attempts.current.delete(report);
            sending.current.delete(report);
            const at = tick();
            setSent((all) => ({
              ...all,
              [report]: { value: [...(all[report]?.value ?? []).filter((one) => one.id !== id), added], at },
            }));
            forget(report);
            setOpenId((now) => (now === report ? null : now));
            stage(report, IDLE);
            return;
          }
        } else {
          const why = await refusal(res);
          failed = why.message;
          /* That id is somebody else's words: the next try needs its own. */
          if (why.reused) attempts.current.delete(report);
        }
      } catch {
        /* The network, or a body that was not JSON: the same sentence. */
      }
      sending.current.delete(report);
      stage(report, { kind: "failed", message: failed });
    },
    [tick, stage, forget],
  );

  const holds =
    Object.values(stages).some((one) => one.kind === "sending") ||
    Object.values(drafts).some((text) => text.trim() !== "");
  return { openId, drafts, stages, sent, holds, open, cancel, setDraft, send };
}

/**
 * **A report's addenda with what this page added laid after the server's**,
 * for as long as the server's account is older than the send: the reply
 * threads' rule (FeedbackEarlier.tsx § `withLocal`), so a receipt counts only
 * if it landed after the read behind `startedAt` began, and one the server
 * already lists is not drawn twice.
 */
export function addendaShown(
  report: string,
  listed: readonly AdminFeedbackAddendum[],
  startedAt: number,
  sent: ReportAddenda["sent"],
): AdminFeedbackAddendum[] {
  const mine = sent[report];
  if (mine === undefined || mine.at <= startedAt) return [...listed];
  return [...listed, ...mine.value.filter((one) => !listed.some((known) => known.id === one.id))];
}

/**
 * **The box itself**, under one report: the reader's words, their microphone
 * (`feedback-addendum:<report>`, so a recording is only ever offered back
 * under the report it was about), *Send addendum* and *Cancel*.
 */
export function AddendumBox({
  report,
  number,
  addenda,
  active,
}: {
  report: string;
  number: number;
  addenda: ReportAddenda;
  /** Whether the box can be seen: the dialog open, on Earlier. */
  active: boolean;
}) {
  const stage = addenda.stages[report] ?? IDLE;
  const sending = stage.kind === "sending";
  return (
    <FeedbackSendBox
      value={addenda.drafts[report] ?? ""}
      onChange={(next) => addenda.setDraft(report, next)}
      onSend={() => void addenda.send(report)}
      sending={sending}
      active={active}
      keeper={`feedback-addendum:${report}`}
      doneKey={{ seen: `addendum:${report}`, hidden: "addendum:hidden" }}
      label={`What to add to report #${number}`}
      placeholder="What to add to this report…"
      sendWord="Send addendum"
      cap={MAX_FEEDBACK_BODY_CHARS}
      className="fb-addendum-box"
      problems={[stage.kind === "failed" ? stage.message : null]}
    >
      <button
        type="button"
        className="fb-copy tone-negative"
        disabled={sending}
        onClick={() => addenda.cancel(report)}
      >
        Cancel
      </button>
    </FeedbackSendBox>
  );
}
