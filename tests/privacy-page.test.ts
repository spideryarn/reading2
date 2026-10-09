/**
 * **The privacy policy has to stay true of the code**, and the part that will
 * go stale first is the list of models a reader's text reaches.
 *
 * The page names them — `claude-sonnet-5`, `gpt-5.6-luna` and the rest — because
 * a policy that says "an AI provider" and stops has told the reader nothing
 * they could check. Naming them is only worth anything if the names are still
 * the ones being sent, and nothing about swapping a model would make anybody
 * open PrivacyPage.tsx. So this test does: add a model to `DISPLAY_NAME` and it
 * goes red naming the page, exactly as `tests/models.test.ts` goes red when
 * `DISPLAY_NAME` itself falls behind the tiers.
 *
 * **The page cannot import the table**, which is why this reads the file as
 * text. `src/models.ts` is a server module — it reaches `src/embeddings.ts` and
 * from there into `node:` — and the client's import graph is asserted closed
 * (tests/client-imports.test.ts). A shared leaf holding just the ids was the
 * alternative and it is not worth a module: the drift is caught either way, and
 * this way the policy stays readable prose rather than a template.
 *
 * The two live-conversation models are checked from `src/live.ts` for the same
 * reason and with the same excuse — that file opens a database pool.
 *
 * **What this test does not check** is everything else on the page: the
 * regions, the retention windows, the subprocessor list, whether we still mean
 * what it says about reading your articles. Those are prose about arrangements
 * rather than about constants, and docs/project/website-text.md lists them as
 * the things to re-read when they move. A test that pretended to cover them
 * would be the worse kind of green.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { BIBLIOGRAPHIC_HOSTS } from "../src/fetch.js";
import { DISPLAY_NAME } from "../src/models.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * The page with its comments removed — **the prose a reader actually sees**,
 * near enough.
 *
 * The first version of this test searched the raw file, and GPT Sol found the
 * hole in it: this file is heavily commented, several of those comments name a
 * model, and a policy that had stopped naming `voyage-4` on the page would go
 * on passing because the word survived in a comment explaining why it was once
 * there. That is exactly [silent success](docs/reusable/silent-success.md) —
 * the check shares an assumption with the thing it checks.
 *
 * Stripping block comments and JSX `{​/* … *​/}` braces is not a parser and does
 * not pretend to be. It is the cheap version of "look at the rendered text",
 * and the assertion below that it removed something is what stops the regex
 * quietly matching nothing and handing back the whole file again.
 */
const PAGE = (() => {
  const raw = readFileSync(path.join(ROOT, "src/web/PrivacyPage.tsx"), "utf8");
  return raw.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
})();

/**
 * **Models the page may name generally rather than by id**, each with the words
 * that must then appear. Greg, 2026-09-30, on the High-powered AI clause:
 * *"approved changes to Privacy (though keep it a bit general, e.g. "Opus or
 * similar frontier model")"*. The model is still covered, by that sentence, and
 * editing the sentence away turns this red exactly as dropping an id would.
 * An entry is Greg's decision, not a convenience: add one only with his say-so.
 * docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md.
 */
const GENERAL_WORDING: Readonly<Record<string, string>> = {
  "claude-opus-5-5": "Opus or a similar frontier model",
};

describe("the privacy page", () => {
  it("is reading the prose rather than the comments", () => {
    /* The positive control for the stripping above. Without it a regex that
       matched nothing would leave `PAGE` as the whole file and every assertion
       below would keep passing while checking the wrong text. The header of
       "GPT Sol" appears three times in the page's comments and nowhere in its
       prose, so its absence is proof the comments went. */
    expect(PAGE).not.toContain("GPT Sol");
    expect(PAGE).toContain("Last updated");
  });

  it("names every model this app can send text to", () => {
    /* `DISPLAY_NAME` maps several wire ids onto one readable name — both
       spellings of Claude land on `claude-sonnet-5-5` — and the readable name is
       what the page should carry. src/models.ts § DISPLAY_NAME. A model with an
       approved general wording is covered by that wording instead. */
    const collapsed = PAGE.replace(/\s+/g, " ");
    const missing = [...new Set(Object.values(DISPLAY_NAME))].filter((name) => {
      const general = GENERAL_WORDING[name];
      return !PAGE.includes(name) && !(general !== undefined && collapsed.includes(general));
    });
    expect(missing, "models missing from src/web/PrivacyPage.tsx").toEqual([]);
    expect(PAGE).toContain("High-powered AI; <code>gpt-6-luna</code>");
  });

  it("has an approved general wording only for models that exist", () => {
    /* A stale entry would be an exemption for nothing, and a way for the table
       to quietly outgrow the one model Greg approved it for. */
    const known = new Set(Object.values(DISPLAY_NAME));
    expect(Object.keys(GENERAL_WORDING).filter((name) => !known.has(name))).toEqual([]);
  });

  it("names the live-conversation models", () => {
    /* Read out of src/live.ts rather than imported: importing it opens a pool.
       The regex is anchored on the `export const` so a mention in a comment
       cannot satisfy it. */
    const live = readFileSync(path.join(ROOT, "src/live.ts"), "utf8");
    /* Both engines' models: Realtime's `LIVE_MODEL` and `LIVE_TRANSCRIBER`, and
       GPT-Live's voice and the backend behind it, which is every reader's
       engine since 2026-10-10 (plan 261010a). */
    const ids = [
      ...live.matchAll(/export const (?:GPT_)?LIVE_(?:MODEL|TRANSCRIBER|BACKEND_MODEL) = "([^"]+)"/g),
    ].map((m) => m[1] as string);
    /* A positive control on the extraction itself: if the shape of those four
       declarations ever changes, `ids` goes short and the assertion below
       passes over less than it should — silent success, and the page would stop
       being checked without a test going red. docs/reusable/silent-success.md. */
    expect(ids).toHaveLength(4);
    expect(ids.filter((id) => !PAGE.includes(id))).toEqual([]);
    /* `gpt-6-luna` is on the page for other jobs too, so its presence alone
       says nothing about live conversation: the live sentence must name it. */
    expect(PAGE.replace(/\s+/g, " ")).toContain(
      "<code>gpt-live-1</code> for the live voice mode, with <code>gpt-6-luna</code> behind it",
    );
  });

  it("says a bug report may carry the reader's own article, and no longer that it never does", () => {
    /* Plan 260913a. The section's last paragraph used to promise that a report
       never carries the article's text; since the tick-box can attach the
       reader's own article to the Sentry copy, that sentence would be false.
       Whitespace is collapsed because the JSX wraps its lines. */
    const prose = PAGE.replace(/\s+/g, " ");
    expect(prose).toContain(
      "If you tick “send extra diagnostics” on a page of one of your own articles",
    );
    expect(prose).toContain("the report may also carry that article");
    expect(prose).toContain("up to a size limit");
    expect(prose).toContain("That goes to Sentry with the rest of the report");
    expect(prose).toContain("though a screenshot you add will show whatever was on your screen");
    /* Scoped to the diagnostics, not the report: a reader can type anything into
       the box and a screenshot can show anything. GPT Sol, stage 2 review, S2-1. */
    expect(prose).toContain("The extra diagnostics never include your notes");
    expect(prose).not.toContain("A bug report never carries your notes");
    expect(prose).not.toContain("never carries is the text of the article");
  });

  it("says the admin is emailed each new reader's address, and the route it takes", () => {
    /* Plan 261001b: the sign-up and upgrade notices carry the address since
       2026-10-01. Each copy is one more place an erasure has to reach, so the
       page has to keep saying so for as long as src/arrivals.ts sends it. */
    const prose = PAGE.replace(/\s+/g, " ");
    expect(prose).toContain("The first time you use Spideryarn after signing up");
    expect(prose).toContain("whenever you move to a bigger plan");
    expect(prose).toContain("we also email ourselves a note with your email address and account id");
    expect(prose).toContain("for a plan, which ones");
    expect(prose).toContain("That note goes through Resend, then our domain’s mail forwarding at Namecheap");
  });

  it("says an administrator may look up account details with an AI assistant, and not your reading", () => {
    /* Plan 261007o: the MCP's list_users and user_activity put readers'
       addresses and activity into the administrator's own AI assistant, which
       is not one of the app's AI calls, so the OpenRouter entry is qualified
       too (Sol's F4). docs/project/privacy.md. */
    const prose = PAGE.replace(/\s+/g, " ");
    expect(prose).toContain("An administrator may also look up account details");
    expect(prose).toContain("but not what you read or wrote");
    expect(prose).toContain("by asking an AI assistant of their choosing, so those details pass through that assistant’s provider");
    expect(prose).toContain("every AI call our reading features make, bar one, goes through them");
  });

  it("says a gift email to an existing reader carries their own remaining allowance", () => {
    /* Plan 261002a: giftMessage's reader letter, in src/store/pg-voucher-emails.ts,
       puts the before and after counts through Resend into that inbox. */
    const prose = PAGE.replace(/\s+/g, " ");
    expect(prose).toContain(
      "if it is already your account’s, the email also says how many articles you had left and how many you have with the gift",
    );
  });

  it("says a gift email may carry a note from whoever gave it", () => {
    /* Plan 261002b: the note to the recipient goes through Resend too. */
    const prose = PAGE.replace(/\s+/g, " ");
    expect(prose).toContain("with a short note from whoever gave it, if they wrote one");
  });

  it("says a gift email may carry the recipient's name, as whoever gave it typed it", () => {
    /* Plan 261007f: `billing_vouchers.recipient_name` opens the email as
       "Dear <name>,", so one more piece of personal data goes through Resend. */
    const prose = PAGE.replace(/\s+/g, " ");
    expect(prose).toContain("and the recipient’s name as that person gave it, if they gave one");
  });

  it("says a gift email may carry a link to an article, which may be a private link", () => {
    /* Plan 261007j: a voucher's starter article is linked from its email, and a
       private one by its private link, kept in the email and sent through Resend. */
    const prose = PAGE.replace(/\s+/g, " ");
    expect(prose).toContain(
      "and a link to one of their articles, if they chose one — for an article that is not public, a private link that lets whoever holds it read that article",
    );
  });

  it("dates the privacy notice to the latest disclosure change", () => {
    expect(PAGE).toContain('const LAST_UPDATED = "10 October 2026"');
  });

  it("says the public shelf's topics are named from shared titles and summaries only", () => {
    /* Plan 261008j, approved as "q-p5h2a7 A": the one privacy line it asked for. */
    const prose = PAGE.replace(/\s+/g, " ");
    expect(prose).toContain(
      "to name the topics on the public shelf, for which it is shown the titles and one-line summaries of the articles shared there and nothing else",
    );
  });

  it("says a reader is emailed when their feedback ships, without their words", () => {
    /* Plan 261002f: scripts/feedback-shipped-emails.ts, run by `npm run deploy`. */
    const prose = PAGE.replace(/\s+/g, " ");
    expect(prose).toContain("If you send us feedback through the Feedback button and we act on it, we email you once the change is live");
    expect(prose).toContain("that email does not quote what you wrote");
  });

  it("says the admin is emailed a copy of each reader's feedback, words and address included", () => {
    /* Plan 261002j: src/feedback-notice.ts mails the report — what they wrote,
       the page address and their email address — through Resend to our inbox. */
    const prose = PAGE.replace(/\s+/g, " ");
    expect(prose).toContain(
      "When you send us feedback, we also email ourselves a copy — what you wrote, the address of the page you were on, and your email address — the same way",
    );
    /* And the bug-report section, which lists where a report goes. */
    expect(prose).toContain("It goes to our database, to Sentry and, as an email, to our own inbox");
  });

  it("names the three indexes a DOI is sent to, and says what is not sent", () => {
    /* Plan 261004h. src/fetch.ts § `BIBLIOGRAPHIC_HOSTS` is the list of hosts
       the server asks about a DOI: Crossref and DataCite since 2026-10-01
       (src/bibliographic.ts), which the page did not name until now, and
       OpenAlex since 2026-10-04 (src/citation-index.ts). Read from that list,
       so a fourth host turns this red until the page names it. */
    const prose = PAGE.replace(/\s+/g, " ");
    const NAME: Record<string, string> = {
      "api.crossref.org": "Crossref",
      "api.datacite.org": "DataCite",
      "api.openalex.org": "OpenAlex",
    };
    expect(BIBLIOGRAPHIC_HOSTS.length).toBeGreaterThanOrEqual(3);
    for (const host of BIBLIOGRAPHIC_HOSTS) {
      const name = NAME[host];
      expect(name, `${host} has no name on the privacy page yet`).toBeDefined();
      expect(prose, host).toContain(name);
    }
    expect(prose).toContain("its DOI");
    expect(prose).toContain("when you look up the works it cites");
    expect(prose).toContain("when you open Reception in Debate");
    expect(prose).toContain("never the article’s text, and nothing about who you are");
  });

  it("says quiz answers are kept, and no longer that they are not", () => {
    /* Plan 261005b: until 2026-10-05 the page said quiz answers "are not
       stored", and it was true. `quiz_attempts` now holds each answer and the
       mark it was given, so that sentence would be a false promise on a public
       page. Held to the table too: if the table goes, this claim should. */
    const prose = PAGE.replace(/\s+/g, " ");
    expect(prose).not.toContain("Quiz answers are the exception");
    expect(prose).not.toContain("are not stored");
    expect(prose).toContain("your answers to quiz questions, with what the AI wrote back about each");
    const schema = readFileSync(path.join(ROOT, "src/db/schema.ts"), "utf8");
    expect(schema).toContain('"quiz_attempts"');
  });

  it("says the command bar's suggestions are made from the profile, and where a pressed one goes", () => {
    /* Plan 261005k, GPT Sol's F5. `gpt-5.6-luna` was already on the page, so
       the model-name check above cannot notice this disclosure being deleted:
       the profile and the reason for reading go to it, and the searches and
       the question it writes from them travel on once pressed. Held to the
       job too: if the call goes, these claims should. */
    const prose = PAGE.replace(/\s+/g, " ");
    expect(prose).toContain(
      "when you ask the command bar to suggest what to do with an article, to write that short list, for which it is shown your profile and your reason for reading the article, with our list of commands",
    );
    expect(prose).toContain("The searches and the question the command bar suggests are worded from what you wrote");
    expect(prose).toContain("Nothing is done with a suggestion until you press it");
    expect(prose).toContain("a search is seen by visitors if you share the article");
    expect(prose).toContain("The chat question waits in Chat’s box until you press Send");
    expect(prose).toContain("Once sent, it is kept like a question you typed and can be searched for on the web");
    /* It must not promise what a prompt cannot guarantee. */
    expect(prose).toContain("we cannot promise that it always does");
    expect(prose).not.toMatch(/never (contain|include)s? anything about you/);
    const models = readFileSync(path.join(ROOT, "src/models.ts"), "utf8");
    expect(models).toContain('{ job: "command-suggest", id: QUICK_MODEL_OPENROUTER');
  });

  it("says a question asked in Help goes to the model, and is neither kept nor logged", () => {
    /* Plan 261007k. `gpt-5.6-luna` was already on the page, so the model-name
       check cannot notice this disclosure being deleted. Held to the job: if
       the call moves to another model, this clause should move with it. */
    const prose = PAGE.replace(/\s+/g, " ");
    expect(prose).toContain("to answer a question you ask in Help’s <em>Ask about Spideryarn</em>");
    expect(prose).toContain("box, for which it is shown that question and the Help pages, and nothing of yours besides");
    expect(prose).toContain("the question is not kept, and is not written to our logs");
    const models = readFileSync(path.join(ROOT, "src/models.ts"), "utf8");
    expect(models).toContain('{ job: "help-chat", id: HELP_CHAT_MODEL');
    expect(models).toContain('export const HELP_CHAT_MODEL = "openai/gpt-6-luna";');
  });

  it("says the guide is told roughly how many other articles you have opened", () => {
    /* Plan 261007j, GPT Sol's F7: a derived account datum sent to the chat
       model, below the cache breakpoint (src/guide.ts § experienceLine). The
       model name was already on the page, so only this sentence notices the
       disclosure going. Held to the code: if the line goes, this claim should. */
    const prose = PAGE.replace(/\s+/g, " ");
    expect(prose).toContain(
      "for the guide in Chat, which is also told roughly how many other articles you have opened here (none, a few, or many)",
    );
    const guide = readFileSync(path.join(ROOT, "src/guide.ts"), "utf8");
    expect(guide).toContain("export function experienceLine");
  });

  it("gives the one contact address rather than spelling one of its own", () => {
    /* docs/project/website-text.md: one address, in src/site-text.ts. A page
       that typed it out would be the second copy that goes stale after a
       domain move. */
    expect(PAGE).toContain("CONTACT_EMAIL");
    expect(PAGE).not.toMatch(/@spideryarn\.com/);
  });

  /**
   * **A private link is a third way somebody else reads your article**
   * (docs/plans/261005e-share-an-article-with-some-people-a-private-link-first.md),
   * so "Who can see your shelf" has to name it. Held to the code as the
   * claims above are: if the link goes, or starts listing, these should fail.
   */
  describe("what it says about a private link", () => {
    const prose = PAGE.replace(/\s+/g, " ");
    const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

    it("names it as an exception beside public, and no longer counts two", () => {
      expect(prose).toContain("private link");
      expect(prose).not.toContain("Two exceptions");
      expect(prose).toContain("Three exceptions");
    });

    it("says anyone who has the link can read without signing in, and can pass it on", () => {
      expect(prose).toMatch(/anyone who has (it|the link) can read (it|the article) without signing in/);
      expect(prose).toMatch(/pass (it|the link) on/);
      expect(read("src/store/link-shared-slug.ts")).toMatch(/eq\(articles\.shareToken, key\)/);
    });

    it("says it is not listed, and that we cannot tell who read it", () => {
      expect(prose).toMatch(/An article shared only this way is not listed anywhere/);
      expect(prose).toMatch(/cannot tell (you )?who (has )?(read|opened)/);
      expect(read("src/store/public-library.ts")).not.toMatch(/from "\.\/public-access\.js"/);
      /* Nothing records a visit: the public routes write nothing. */
      expect(read("src/db/schema.ts")).not.toMatch(/share_link_(reads|visits|opens)/);
    });

    it("says they get what a public reader gets", () => {
      expect(prose).toMatch(/same things? a public (article'?s )?reader gets/);
    });

    it("says it can be turned off, and what that cannot take back", () => {
      expect(prose).toMatch(/[Tt]urn(ing)? (it|the link) off/);
      expect(read("src/web/PrivateLink.tsx")).toMatch(/Turn off/);
    });

    it("says the key is in the address, so it is in a browser's history", () => {
      expect(prose).toMatch(/browser(’s|'s)? history/);
    });

    it("says a bug report from such a page leaves the key out, and the button does", () => {
      expect(prose).toMatch(/without the (link’s|link's) key/);
      expect(read("src/web/FeedbackButton.tsx")).toMatch(/url: withoutShareKey\(location\.href\)/);
    });

    it("counts making and turning off a link in the audit trail, and the table exists", () => {
      expect(prose).toMatch(/when a private link (to it )?was made or turned off/);
      expect(read("src/db/schema.ts")).toContain('"article_share_link_events"');
    });

    it("covers a private link in what taken down means", () => {
      expect(prose).toMatch(/turn off any private link/);
    });
  });
});
