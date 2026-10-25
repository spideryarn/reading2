/**
 * **The email frame has one source**: src/email-frame.ts. The gift email is
 * built from it; the two Supabase templates are hand-written files GoTrue reads
 * from disk, so this checks they are exactly that frame around their own rows.
 * Plan 261025k § 1.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { EMAIL_TEMPLATES } from "../scripts/supabase-auth-config.js";
import { EMAIL_BODY_CLOSE, EMAIL_BODY_OPEN, EMAIL_FOOTER_ROW, emailButton, emailHead } from "../src/email-frame.js";
import { giftMessage } from "../src/store/pg-voucher-emails.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The parts of an email that are not the frame: its title and the rows
 * between the wordmark and the footer. Throws, naming the part, when the frame
 * around them is not exactly ours.
 */
function framed(html: string): { readonly title: string; readonly rows: string } {
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
  if (title === undefined) throw new Error("no <title>");
  const open = emailHead(title) + EMAIL_BODY_OPEN;
  const close = EMAIL_FOOTER_ROW + EMAIL_BODY_CLOSE;
  expect(html.startsWith(open), "the head and the wordmark row are the frame's").toBe(true);
  expect(html.endsWith(close), "the footer row and the closers are the frame's").toBe(true);
  return { title, rows: html.slice(open.length, html.length - close.length) };
}

describe.each(EMAIL_TEMPLATES)("supabase/templates/%s.html", (name) => {
  const file = readFileSync(path.join(ROOT, "supabase", "templates", `${name}.html`), "utf8");
  /* Its own leading comment, kept: it says what the template is and how it ships. */
  const comment = /^<!--[\s\S]*?-->\n/.exec(file)?.[0] ?? "";
  const html = file.slice(comment.length);

  it("opens with its own comment", () => {
    expect(comment).not.toBe("");
  });

  it("is the frame from src/email-frame.ts around its own rows", () => {
    const { title, rows } = framed(html);
    expect(title).not.toBe("");
    expect(rows).not.toContain("<!--");
    expect(rows).not.toContain("</body>");
  });

  it("draws its button with the frame's button, on Supabase's own link", () => {
    const { rows } = framed(html);
    const label = /<a href="\{\{ \.ConfirmationURL \}\}"[^>]*>([^<]*)<\/a>/.exec(rows)?.[1];
    if (label === undefined) throw new Error("no button on {{ .ConfirmationURL }}");
    expect(rows).toContain(emailButton({ label, url: "{{ .ConfirmationURL }}" }));
  });
});

describe("the gift email", () => {
  it.each([
    ["an invite", giftMessage(3)],
    ["a reader", giftMessage(2, { kind: "reader", plan: { kind: "paid" } })],
  ])("to %s is the same frame, titled with its subject", (_, message) => {
    const { title } = framed(message.html ?? "");
    expect(title).toBe(message.subject);
  });
});
