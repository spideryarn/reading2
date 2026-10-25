/**
 * **The HTML frame every email of ours is drawn in**: the head, the dark outer
 * tables, the spider-and-wordmark row, the footer row, and the orange button.
 * Plan 261025k § 1; docs/project/email.md.
 *
 * **One source, two kinds of reader.** The gift email (`giftHtml` in
 * src/store/pg-voucher-emails.ts) is built from these strings. The two auth
 * emails, supabase/templates/confirmation.html and recovery.html, stay
 * hand-written files, because GoTrue reads them from disk and
 * `scripts/supabase-auth-config.ts templates` sends them as they are — so
 * tests/email-frame.test.ts checks that each one is exactly its own comment,
 * `emailHead(<its title>)`, `EMAIL_BODY_OPEN`, its own rows (with
 * `emailButton` on `{{ .ConfirmationURL }}`), `EMAIL_FOOTER_ROW` and
 * `EMAIL_BODY_CLOSE`. Change the frame here and that test stays red until both
 * templates are changed to match.
 *
 * Every value interpolated here is ours; a caller escapes anything that is not
 * before it reaches a row.
 */

import { PUBLIC_ORIGIN } from "./urls.js";

/** The doctype and `<head>`, through `</head>`. `title` is the subject, already safe as markup. */
export function emailHead(title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${title}</title>
</head>
`;
}

/** `<body>` and the two tables, through the spider-and-wordmark row. The email's own rows follow. */
export const EMAIL_BODY_OPEN = `<body style="margin:0;padding:0;background-color:#0a0a0a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0a0a" style="background-color:#0a0a0a;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e5e5e5;">
<tr><td style="padding:0 0 32px 0;">
<img src="${PUBLIC_ORIGIN}/apple-touch-icon.png" width="32" height="32" alt="" style="display:inline-block;vertical-align:middle;border:0;">
<span style="display:inline-block;vertical-align:middle;margin-left:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:600;color:#DB8A45;">Spideryarn</span>
</td></tr>
`;

/** The last row: what Spideryarn is, and where to write. */
export const EMAIL_FOOTER_ROW = `<tr><td style="font-size:13px;line-height:1.6;color:#a3a3a3;border-top:1px solid #262626;padding:20px 0 0 0;">Spideryarn helps you read deeply and efficiently. Questions? Reply to this email, or write to <a href="mailto:hello@spideryarn.com" style="color:#a3a3a3;">hello@spideryarn.com</a>.</td></tr>
`;

/** Everything after the footer row. */
export const EMAIL_BODY_CLOSE = `</table>
</td></tr>
</table>
</body>
</html>
`;

/** The orange button. `url` and `label` are put in as given, so escape them first if they are not ours. */
export function emailButton(button: { readonly label: string; readonly url: string }): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#DB8A45" style="background-color:#DB8A45;border-radius:6px;padding:12px 24px;"><a href="${button.url}" style="color:#0a0a0a;font-size:16px;font-weight:600;text-decoration:none;display:inline-block;">${button.label}</a></td></tr></table>`;
}
