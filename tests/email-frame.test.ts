/**
 * **The email frame has one source**: src/email-frame.ts. The gift email is
 * built from it; the two Supabase templates are hand-written files GoTrue reads
 * from disk, so this compares each complete email with that shared composer.
 * Plan 261025k § 1.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { EMAIL_TEMPLATES } from "../scripts/supabase-auth-config.js";
import { emailHtml } from "../src/email-frame.js";
import { giftMessage } from "../src/store/pg-voucher-emails.js";
import { PUBLIC_ORIGIN } from "../src/urls.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

interface FramedEmail {
  readonly title: string;
  readonly heading: string;
  readonly rows: string;
  readonly button: { readonly label: string; readonly url: string };
  readonly after: string;
}

const AUTH_EMAILS: readonly ({ readonly name: string } & FramedEmail)[] = [
  {
    name: "confirmation",
    title: "Confirm your email for Spideryarn",
    heading: "Confirm your email",
    rows:
      '<tr><td style="font-size:16px;line-height:1.6;padding:0 0 28px 0;">You signed up to Spideryarn with this address. Confirm it, and your shelf is ready for the first thing you want to read.</td></tr>',
    button: { label: "Confirm my email", url: "{{ .ConfirmationURL }}" },
    after: "The link works once. If you did not sign up, you can ignore this email.",
  },
  {
    name: "recovery",
    title: "Reset your Spideryarn password",
    heading: "Reset your Spideryarn password",
    rows:
      '<tr><td style="font-size:16px;line-height:1.6;padding:0 0 28px 0;">Somebody asked to reset the password of the Spideryarn account at this address. If it was you, use the button below, in the same browser you asked from, to choose a new one.</td></tr>',
    button: { label: "Choose a new password", url: "{{ .ConfirmationURL }}" },
    after:
      "The link works once. If you did not ask, you can ignore this email: your password stays as it is.",
  },
];

function withoutComment(file: string): { readonly comment: string; readonly html: string } {
  const comment = /^<!--[\s\S]*?-->\n/.exec(file)?.[0];
  if (comment === undefined) throw new Error("no leading template comment");
  return { comment, html: file.slice(comment.length) };
}

function expectEmail(html: string, expected: FramedEmail): void {
  expect(html).toBe(emailHtml(expected));
}

describe("the two hand-written auth templates", () => {
  it("cannot pass vacuously if the production template list becomes empty or loses one", () => {
    expect(EMAIL_TEMPLATES).toEqual(AUTH_EMAILS.map((email) => email.name));
  });

  for (const expected of AUTH_EMAILS) {
    const file = readFileSync(path.join(ROOT, "supabase", "templates", `${expected.name}.html`), "utf8");
    const { comment, html } = withoutComment(file);

    it(`${expected.name}.html keeps its own leading comment`, () => {
      expect(comment).toContain(
        `Spideryarn: ${expected.name === "confirmation" ? "confirm your email" : "reset your password"}`,
      );
    });

    it(`${expected.name}.html is exactly the shared frame around its own words`, () => {
      expectEmail(html, expected);
    });

    it(`${expected.name}.html rejects drift in every shared middle row`, () => {
      const drifts = [
        html.replace("font-size:22px", "font-size:21px"),
        html.replace(
          'style="padding:0 0 28px 0;">\n<table role="presentation"',
          'style="padding:0 0 27px 0;">\n<table role="presentation"',
        ),
        html.replace("font-size:14px", "font-size:15px"),
      ];
      for (const drifted of drifts) {
        expect(drifted).not.toBe(html);
        expect(() => expectEmail(drifted, expected)).toThrow();
      }
    });
  }
});

describe("the gift email", () => {
  it.each([
    {
      name: "an invite",
      message: giftMessage(3),
      expected: {
        title: "A gift of 3 free articles on Spideryarn",
        heading: "A gift of 3 free articles",
        rows:
          '<tr><td style="font-size:16px;line-height:1.6;padding:0 0 16px 0;">You have been given 3 free articles on Spideryarn, for this email address. Spideryarn is a reading tool: add an article or a paper, and it helps you read it deeply and efficiently. It highlights, annotates and explains, but keeps you in the text itself.</td></tr>\n' +
          '<tr><td style="font-size:16px;line-height:1.6;padding:0 0 28px 0;">Sign in, or create an account, with this same address. The articles are added to your free allowance when you do, with no code to type in.</td></tr>',
        button: { label: "Sign in or create an account", url: `${PUBLIC_ORIGIN}/login` },
        after:
          "They come on top of the three articles every free account starts with. If you use Continue with Google, choose the Google account for this address. If you were not expecting this, you can ignore this email.",
      },
    },
    {
      name: "a paid reader",
      message: giftMessage(2, { kind: "reader", plan: { kind: "paid" } }),
      expected: {
        title: "A gift of 2 free articles on Spideryarn",
        heading: "A gift of 2 free articles",
        rows:
          '<tr><td style="font-size:16px;line-height:1.6;padding:0 0 16px 0;">You have been given 2 free articles on Spideryarn, for your account with this address.</td></tr>\n' +
          '<tr><td style="font-size:16px;line-height:1.6;padding:0 0 16px 0;">You are on a paid plan, so you do not need them today. They stay on your account, and count whenever you are on the Free plan.</td></tr>\n' +
          '<tr><td style="font-size:16px;line-height:1.6;padding:0 0 28px 0;">They are added the next time you open Spideryarn while signed in, with nothing to type in.</td></tr>',
        button: { label: "Open Spideryarn", url: `${PUBLIC_ORIGIN}/` },
        after: "If you were not expecting this, you can ignore this email.",
      },
    },
  ])("renders $name byte for byte through the shared composer", ({ message, expected }) => {
    expect(message.subject).toBe(expected.title);
    expectEmail(message.html ?? "", expected);
  });
});
