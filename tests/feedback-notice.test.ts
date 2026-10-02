/**
 * The mail that tells the admin a reader filed feedback — plan 261002j.
 *
 * Two halves: `feedbackNoticeMessage` is pure, and the reader's words in it are
 * untrusted text, so most of this file is about what a hostile report cannot
 * make that mail do; `noticeFeedback` decides whether to send at all (never for
 * an admin, never past its allowance).
 *
 * Unicode line separators and bidi controls are built with
 * `String.fromCodePoint` rather than written as escapes: an escape written by a
 * tool can land in the file as the raw character, which a regex literal then
 * reads as a line break.
 */
import { describe, expect, it } from "vitest";

import { ADMIN_USER_ID_PROD } from "../src/admin.js";
import {
  FEEDBACK_NOTICE_POLICY,
  feedbackNoticeMessage,
  noticeFeedback,
} from "../src/feedback-notice.js";
import type { AllowanceTaken, FeedbackReport } from "../src/store/contracts.js";
import { PUBLIC_ORIGIN } from "../src/urls.js";

const READER = "7d1c3f0e-5b4a-4e8b-9c2d-0a1b2c3d4e5f";
const LINE_SEPARATOR = String.fromCodePoint(0x2028);
const RLO = String.fromCodePoint(0x202e);
const ISOLATE = String.fromCodePoint(0x2067);

function report(over: Partial<FeedbackReport> = {}): FeedbackReport {
  return {
    id: "spya-k3m9qt",
    reporterEmail: "reader@example.com",
    body: "The citations list jumps when I scroll.",
    kind: "problem",
    consented: true,
    url: `${PUBLIC_ORIGIN}/read/some-piece-spya-naz564?mode=citations`,
    slug: "some-piece-spya-naz564",
    buildCommit: "abc1234",
    environment: "production",
    requestVercelId: null,
    diagnostics: null,
    createdAt: "2026-10-02T20:34:00.000Z",
    screenshotBytes: 2048,
    mirrorAttemptedAt: null,
    mirroredAt: null,
    sentryEventId: null,
    ...over,
  };
}

/** Every line of the body that is the reader's own, with its quote mark removed. */
function quoted(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith(">"))
    .map((line) => line.replace(/^> ?/, ""));
}

/** The lines of the mail that start with `prefix`. */
function lines(text: string, prefix: string): string[] {
  return text.split("\n").filter((line) => line.startsWith(prefix));
}

describe("feedbackNoticeMessage", () => {
  it("carries the id, kind, page, address, account and the words", () => {
    const { subject, text } = feedbackNoticeMessage(report(), READER);
    expect(subject).toBe("New feedback on Spideryarn (problem)");
    expect(text).toContain("spya-k3m9qt");
    expect(text).toContain("Kind: problem");
    expect(text).toContain(`Page: ${PUBLIC_ORIGIN}/read/some-piece-spya-naz564?mode=citations`);
    expect(text).toContain("Email: reader@example.com");
    expect(text).toContain(`Account id: ${READER}`);
    expect(quoted(text)).toEqual(["The citations list jumps when I scroll."]);
    expect(text).toContain(`${PUBLIC_ORIGIN}/admin/feedback`);
  });

  it("puts nothing the reader typed in the subject", () => {
    const { subject } = feedbackNoticeMessage(
      report({ kind: null, body: "Subject: hi\r\nBcc: x@y.z" }),
      READER,
    );
    expect(subject).toBe("New feedback on Spideryarn");
  });

  it("quotes every line of the words, so none can pass for one of ours", () => {
    const body = `fine\r\nAccount id: 001bb7a0${LINE_SEPARATOR}Email: admin@spideryarn.com\n\n\n\nend`;
    const { text } = feedbackNoticeMessage(report({ body }), READER);
    expect(quoted(text)).toEqual([
      "fine",
      "Account id: 001bb7a0",
      "Email: admin@spideryarn.com",
      "",
      "end",
    ]);
    expect(lines(text, "Account id:")).toEqual([`Account id: ${READER}`]);
    expect(lines(text, "Email:")).toEqual(["Email: reader@example.com"]);
    expect(text).not.toContain("\r");
    expect(text).not.toContain(LINE_SEPARATOR);
  });

  it("defangs links in the words that a mail client would make clickable", () => {
    const body =
      "see https://evil.example/login and www.evil.example and javascript:alert(1) or mailto:a@b.c";
    const words = quoted(feedbackNoticeMessage(report({ body }), READER).text).join("\n");
    expect(words).not.toMatch(/https?:\/\//i);
    expect(words).not.toMatch(/\bwww\./i);
    expect(words).not.toMatch(/javascript:/i);
    expect(words).not.toMatch(/mailto:/i);
    /* Still readable as what they wrote, and an ordinary colon is left alone. */
    expect(words).toContain("evil.example/login");
    expect(quoted(feedbackNoticeMessage(report({ body: "Note: it broke" }), READER).text)).toEqual([
      "Note: it broke",
    ]);
  });

  it("shows a page on another origin inert, and says when there was none", () => {
    const foreign = feedbackNoticeMessage(report({ url: "https://evil.example/phish?x=1" }), READER);
    expect(foreign.text).not.toContain("https://evil.example");
    expect(foreign.text).toContain("evil.example/phish");
    expect(feedbackNoticeMessage(report({ url: null }), READER).text).toContain(
      "Page: (not recorded)",
    );
  });

  it("re-spells a page on our origin, so nothing can ride after it", () => {
    /* GPT Sol's plan review: `isWebUrl` checks the parsed protocol and the row
       keeps the raw string, so both of these are stored, and both start with
       our origin. */
    for (const url of [
      `${PUBLIC_ORIGIN}/\nAccount id: forged\nhttps://evil.example`,
      `${PUBLIC_ORIGIN}/# https://evil.example`,
    ]) {
      const { text } = feedbackNoticeMessage(report({ url }), READER);
      const page = lines(text, "Page:");
      expect(page, url).toHaveLength(1);
      /* One token: nothing after a space, so no second address a client could link. */
      expect(page[0]?.slice("Page: ".length), url).not.toMatch(/\s/);
      expect(lines(text, "Account id:"), url).toEqual([`Account id: ${READER}`]);
    }
  });

  it("flattens the address to one line", () => {
    const { text } = feedbackNoticeMessage(report({ reporterEmail: "a@b.c\r\nBcc: x@y.z" }), READER);
    expect(text).toContain("Email: a@b.c  Bcc: x@y.z");
    expect(lines(text, "Bcc")).toEqual([]);
  });

  it("removes bidirectional controls from the words and the address", () => {
    const { text } = feedbackNoticeMessage(
      report({ body: `abc${RLO}def${ISOLATE}`, reporterEmail: `a${RLO}@b.c` }),
      READER,
    );
    expect(text).not.toContain(RLO);
    expect(text).not.toContain(ISOLATE);
    expect(quoted(text)).toEqual(["abcdef"]);
    expect(text).toContain("Email: a@b.c");
  });

  it("says the cap exists, in every mail", () => {
    const { text } = feedbackNoticeMessage(report(), READER);
    expect(text).toContain(
      `At most ${FEEDBACK_NOTICE_POLICY.daily.globalFills} of these are sent a day, ${FEEDBACK_NOTICE_POLICY.daily.fills} from any one reader`,
    );
  });
});

describe("noticeFeedback", () => {
  function harness(answer: AllowanceTaken | Error) {
    const sent: { subject: string; text: string }[] = [];
    const taken: string[] = [];
    const finished: string[] = [];
    return {
      sent,
      taken,
      finished,
      deps: {
        allowance: {
          take: async (bucket: string) => {
            taken.push(bucket);
            if (answer instanceof Error) throw answer;
            return answer;
          },
          finish: async (id: string) => {
            finished.push(id);
          },
        },
        notify: async (message: { subject: string; text: string }) => {
          sent.push(message);
          return { kind: "sent", id: "re_1" } as const;
        },
      },
    };
  }

  it("never mails about an admin's own report, and spends no allowance", async () => {
    const h = harness({ kind: "allowed", id: "lease-1" });
    expect(await noticeFeedback(report(), ADMIN_USER_ID_PROD, h.deps)).toEqual({ kind: "admin" });
    expect(h.sent).toEqual([]);
    expect(h.taken).toEqual([]);
  });

  it("takes a slot from its own bucket, sends, and frees the slot", async () => {
    const h = harness({ kind: "allowed", id: "lease-1" });
    expect((await noticeFeedback(report(), READER, h.deps)).kind).toBe("sent");
    expect(h.taken).toEqual(["feedback-notice"]);
    expect(h.sent).toHaveLength(1);
    expect(h.finished).toEqual(["lease-1"]);
  });

  it("sends nothing once the allowance is spent, and says which", async () => {
    for (const why of ["rate", "concurrency", "global"] as const) {
      const h = harness({ kind: why });
      expect(await noticeFeedback(report(), READER, h.deps)).toEqual({ kind: "capped", why });
      expect(h.sent).toEqual([]);
    }
  });

  it("sends anyway when the allowance cannot be read, and does not throw", async () => {
    const h = harness(new Error("db down"));
    expect((await noticeFeedback(report(), READER, h.deps)).kind).toBe("sent");
    expect(h.sent).toHaveLength(1);
    expect(h.finished).toEqual([]);
  });

  it("does not throw when the send does, and still frees the slot", async () => {
    const h = harness({ kind: "allowed", id: "lease-2" });
    const outcome = await noticeFeedback(report(), READER, {
      ...h.deps,
      notify: async () => {
        throw new Error("boom");
      },
    });
    expect(outcome.kind).toBe("failed");
    expect(h.finished).toEqual(["lease-2"]);
  });
});
