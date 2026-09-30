/**
 * The two auth emails in Spideryarn's own words: supabase/templates/, the
 * sections of supabase/config.toml that name them, and what
 * `scripts/supabase-auth-config.ts templates` would send to production.
 *
 * What a server is needed for (the email arriving and its link signing
 * somebody in) was measured end to end on a throwaway stack instead:
 * docs/plans/260930h-auth-emails-in-spideryarn-s-voice.md § What the spike
 * found. This file pins what can go wrong without one.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { EMAIL_TEMPLATES, templatesBody } from "../scripts/supabase-auth-config.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = readFileSync(path.join(ROOT, "supabase", "config.toml"), "utf8");

describe.each(EMAIL_TEMPLATES)("the %s email", (name) => {
  const html = readFileSync(path.join(ROOT, "supabase", "templates", `${name}.html`), "utf8");

  /* The security-relevant line. `{{ .ConfirmationURL }}` is built by GoTrue, so
     the redirect allow-list still decides where a one-time code may go; a link
     assembled here from `{{ .TokenHash }}` and `{{ .RedirectTo }}` would move
     that decision into this HTML. */
  it("has one button, and it carries Supabase's own link unaltered", () => {
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs.filter((h) => h !== "mailto:hello@spideryarn.com")).toEqual([
      "{{ .ConfirmationURL }}",
    ]);
  });

  it("uses no other template value", () => {
    const actions = [...html.matchAll(/\{\{[^}]*\}\}/g)].map((m) => m[0]);
    expect(new Set(actions)).toEqual(new Set(["{{ .ConfirmationURL }}"]));
    /* An unbalanced brace is a Go template parse error, and GoTrue then sends
       its own default. */
    expect(html.split("{{").length).toBe(html.split("}}").length);
  });

  it("is ours, not Supabase's boilerplate", () => {
    expect(html).toContain("Spideryarn");
    expect(html).not.toMatch(/Confirm your signup|Follow this link/i);
  });
});

describe("templatesBody", () => {
  it("sends the subjects and files config.toml names, and nothing else", () => {
    const body = templatesBody(CONFIG, ROOT);
    expect(Object.keys(body).sort()).toEqual([
      "mailer_subjects_confirmation",
      "mailer_subjects_recovery",
      "mailer_templates_confirmation_content",
      "mailer_templates_recovery_content",
    ]);
    expect(body.mailer_subjects_confirmation).toBe("Confirm your email for Spideryarn");
    expect(body.mailer_subjects_recovery).toBe("Your Spideryarn sign-in link");
    expect(body.mailer_templates_recovery_content).toBe(
      readFileSync(path.join(ROOT, "supabase", "templates", "recovery.html"), "utf8"),
    );
  });

  /* An empty string PATCHed to production quietly restores Supabase's default,
     so each gap must stop the command rather than send "". */
  it("refuses a missing section, subject or file, and a template with no link", () => {
    const without = (needle: string) => CONFIG.replace(needle, "");
    expect(() => templatesBody(without("[auth.email.template.recovery]"), ROOT)).toThrow();
    expect(() =>
      templatesBody(without('subject = "Your Spideryarn sign-in link"'), ROOT),
    ).toThrow(/no subject for \[auth\.email\.template\.recovery\]/);
    /* Not merely the variable somewhere in the file: a comment mentioning it
       would satisfy that with the button deleted. GPT Sol, plan review. */
    expect(() =>
      templatesBody(CONFIG, ROOT, () => "<!-- {{ .ConfirmationURL }} --><p>no button</p>"),
    ).toThrow(/exactly one href="\{\{ \.ConfirmationURL \}\}"/);
  });

  /* A swapped or stray path would upload the wrong email under the right
     subject, and nothing downstream would notice until somebody read one. */
  it("refuses a content_path other than supabase/templates/<name>.html", () => {
    const swapped = CONFIG.replace(
      'content_path = "./supabase/templates/recovery.html"',
      'content_path = "./supabase/templates/confirmation.html"',
    );
    expect(() => templatesBody(swapped, ROOT)).toThrow(/must be supabase\/templates\/recovery\.html/);
    expect(() => templatesBody(CONFIG, path.join(ROOT, "no-such-dir"))).toThrow(/ENOENT/);
  });
});
