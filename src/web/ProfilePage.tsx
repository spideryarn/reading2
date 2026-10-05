/**
 * `/profile` — you, rather than an article.
 *
 * Greg, 2026-08-26, on where the two halves of the reader profile should live:
 *
 * > The text-level profile should be in the text-level Metadata, and the
 * > user-level profile should be in its own new `/profile` page (linked to from
 * > the Home page). Signpost from the text-level to the user-level page.
 *
 * and on what else belongs here:
 *
 * > include other useful stuff, e.g. which are the default models, most recent
 * > handful of docs, and anything else you think would be useful.
 *
 * ## The box is the least of it
 *
 * The previous version had this page and this box — a `BackgroundForm` writing
 * free text to `profiles.background`, whose own reference doc said it fed
 * summaries, glossary and chat. **No code path ever read it back into a
 * prompt.** Same for its per-document "Reading Intent": stored, displayed,
 * never sent. So the textarea below is the easy half, and the reason this page
 * was built after the plumbing rather than before it.
 * docs/project/reader-profile.md.
 *
 * ## What is on the page, and what is deliberately not
 *
 * Everything besides the box is **already computed** and costs no new plumbing:
 * the model table is a read of `TASK_TIER` (through the API, because src/web/
 * may not import a server module), and the recent list is `GET /api/library`,
 * which the shelf already fetches.
 *
 * **The plan arrived on 2026-09-03**, and it is here because the quota's own
 * refusal messages had been pointing at *"the Upgrade button on your profile
 * page"* since the wall went up, with no such button anywhere. BillingSection.tsx
 * has it, and docs/project/billing.md has what is behind it.
 *
 * **Settings arrived on 2026-08-31**, and they are a different kind of thing
 * from the rest of this page: the profile box says what the model is told, and
 * a setting says what the app does. One switch so far — experimental features,
 * off by default — in SettingsSection.tsx, with
 * docs/project/experimental-features.md behind it.
 *
 * Not here, and each was considered rather than forgotten: **expertise
 * sliders** (the original's beginner/intermediate/expert axis, rejected twice
 * in this repo — the free-text box above *is* the single global setting its own
 * doc recommended instead); **typography settings** (*"a reader who wants
 * bigger text has a browser zoom"*); **a difficulty score**, for the reason
 * docs/plans/260825e-metadata-page.md gives; and **streaks or anything that counts at you**, which
 * the original's homepage did not have either. This is a reading tool.
 */
import { useEffect, useRef, useState } from "react";
import { BookOpen, Cpu, SlidersHorizontal, User, UserCheck, Wallet } from "lucide-react";
import { MAX_PROFILE_CHARS, type LibraryEntry } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { ownLabel } from "./lib/own-label.js";
import { Link } from "./Link.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { readHref } from "./router.js";
import { AccountSection } from "./AccountSection.js";
import { BillingSection } from "./BillingSection.js";
import { ProfileBox } from "./ProfileBox.js";
import { CONTENTS_MARGIN, PageContents } from "./PageContents.js";
import type { SynonymTable } from "./page-search.js";
/* The Metadata page's section, shared since 2026-10-03 so the two read as one
   app and fold the same way. This page had a private copy of the heading. */
import { Section } from "./PageSection.js";
import { SettingsSection } from "./SettingsSection.js";
import { AppearanceSetting } from "./AppearanceSetting.js";
import { SiteFooter } from "./SiteFooter.js";
import { useProfile } from "./useProfile.js";
import { useSlow } from "./useSlow.js";
import { articleTitleVoice, withVoice } from "./voice.js";

const CARD = "tw:rounded-lg tw:border tw:border-border tw:bg-card";

/**
 * How many recent articles to list, and the cap is **said out loud** below.
 *
 * The original showed ten and printed "Showing your 10 most recent documents"
 * when it hit the limit, which is the right instinct and the same rule chat's
 * tool results had to learn the hard way: a capped list that says nothing about
 * being capped is one the reader believes is complete
 * (docs/project/chat-tools.md).
 */
const RECENT = 8;

/**
 * One row of `GET /api/models`.
 *
 * `model` and `id` are two spellings of the same thing and both are here on
 * purpose. Until 2026-08-27 there was only `id`, printed straight into the row,
 * so this table showed seven jobs on `claude-sonnet-5` and three on
 * `anthropic/claude-sonnet-5` — one model, two names, and a reader with no way
 * to tell whether that was a difference or a prefix. `model` is the name; `id`
 * is the exact string sent, kept because "what did it actually send" is a fair
 * question and the answer should be a hover away rather than a grep. See
 * src/models.ts § the third spelling.
 */
type ModelRow = {
  task: string;
  model: string;
  id: string;
  provider: string;
  /** Absent on the rows that are not tasks (the PDF reader, the embedding model). */
  wire?: string;
  /** `"override"` when an environment variable, not the code, chose this model. */
  source: "default" | "override";
  effort?: string;
};

/**
 * The wire, as a person would write it.
 *
 * This is the half that makes the table make sense rather than merely look
 * tidy: seven jobs and three jobs run on the same model and get to it two
 * different ways, and hiding the prefix without saying so would have replaced a
 * confusing table with a quietly incomplete one. The name answers *which
 * model*; this answers *and how*.
 *
 * Falls back to the server's own string for anything unlisted, on the same
 * reasoning as `displayName` in src/models.ts — an unknown value should show
 * itself, not be swallowed. Read through `ownLabel` (lib/own-label.ts), as
 * `WIRE_LABEL` is: a bare lookup answers with an object for `__proto__`, and
 * `??` lets an object through.
 */
const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
};

/**
 * **What each row says now that every row says OpenRouter.**
 *
 * Until 2026-08-27 the provider column separated the seven pipeline stages
 * (Anthropic's own API) from the three request-path ones (OpenRouter). That
 * distinction is gone — everything goes through OpenRouter — and a column with
 * one value in it tells a reader nothing.
 *
 * The axis that still varies is the *protocol*: the pipeline stages speak
 * Anthropic's Messages shape through OpenRouter's compatible endpoint, the
 * request-path ones speak OpenAI's. That is a real difference to anyone
 * debugging a call, and it is what replaces the old split. See
 * src/messages-stream.ts.
 */
const WIRE_LABEL: Record<string, string> = {
  messages: "Messages",
  chat: "chat",
};

/* Profile's billing vocabulary. Metadata's archive/hide/shelf and size/count
   groups would send "archived articles" or "font size" to Recently read, and
   make "hide experimental features" miss Settings. The remaining words are
   already the sections' keywords; article actions are not Profile actions. */
const PROFILE_SYNONYMS: SynonymTable = [
  ["cost", "price", "spend", "spent", "money", "dollar", "bill", "expense", "charge", "paid", "usage"],
];

export function ProfilePage() {
  useDocumentTitle(pageTitle({ kind: "profile" }));

  const profile = useProfile();
  const [shelf, setShelf] = useState<LibraryEntry[] | "error" | null>(null);
  const [models, setModels] = useState<ModelRow[] | "error" | null>(null);
  /* The card below stands in place of the list, so it follows the same rule the
     panels do: nothing for the first 600ms, because a line that appears and
     vanishes reads as breakage. useSlow.ts. */
  const slowShelf = useSlow(shelf === null);
  /* What the contents list reads its sections from, and resolves them inside. */
  const body = useRef<HTMLElement>(null);

  useEffect(() => {
    let live = true;
    apiFetch("/api/library")
      .then((r) => readJson<{ articles: LibraryEntry[] }>(r))
      .then((body) => live && setShelf(body.articles))
      /* `[]` here said "Nothing on the shelf yet." to a reader whose shelf is
         full and whose request simply failed — the same wrong-and-worrying
         claim as the empty chat list, and the third state below already had the
         fix written out beside it. What the message must not do is guess *why*:
         this catches anything `readJson` throws, including a 500 and a
         non-JSON 200, so it says we could not load it rather than that the
         network was down. docs/project/web-client.md § Empty is not the same as
         not asked yet. */
      .catch(() => live && setShelf("error"));
    apiFetch("/api/models")
      .then((r) => readJson<{ tasks: ModelRow[] }>(r))
      .then((body) => live && setModels(body.tasks))
      /* `[]` would render an empty card that looks exactly like a server with
         nothing configured, which is the one answer this section must never
         give by accident. `"error"` is a third state on purpose. */
      .catch(() => live && setModels("error"));
    return () => {
      live = false;
    };
  }, []);

  /* Most recently opened first, falling back to when it was added — a shelf
     where nothing has been opened yet must not come back empty-looking. */
  /* The rows, once there are rows. `null` is "not asked yet" and `"error"` is
     "asked and it failed", and neither is a shelf — so nothing below may count
     them as one. See the fetch above. */
  const entries = Array.isArray(shelf) ? shelf : [];
  const recent = entries
    .filter((a) => !a.archivedAt)
    .slice()
    .sort((a, b) => (b.lastOpenedAt ?? b.addedAt ?? "").localeCompare(a.lastOpenedAt ?? a.addedAt ?? ""))
    .slice(0, RECENT);

  const onShelf = entries.filter((a) => !a.archivedAt);
  /* Each entry's `words` is the **body's** words — footnotes and bibliographies
     are excluded from the clock (`countsTowardReadingTime` in
     src/block-policy.ts), and `LibraryEntry.words` says so. So this sum is not
     "every word on the shelf", and the line below must not claim it is. The
     other half is not available here to show beside it: the shelf reads stored
     scalars, and only the body figure is stored. */
  const words = onShelf.reduce((n, a) => n + (a.words ?? 0), 0);

  return (
    <>
      {/* **Metadata's contents list, in the left margin, with its search box.**
          Greg, 2026-10-03, asked whether this page gets it as well as the
          folding: *"Probably B"*, B being this. It reads the `[data-section]`
          elements inside `main`, so there is no list of the six to keep in
          step. Hidden below `lg`; `CONTENTS_MARGIN` is the room it needs from
          there until the centred margin holds it.
          docs/plans/261003n-profile-gets-the-contents-list-and-search-box.md. */}
      <PageContents containerRef={body} label="Sections of this page" synonyms={PROFILE_SYNONYMS} />
    <main
      ref={body}
      className={`tw:mx-auto ${CONTENTS_MARGIN} tw:max-w-3xl tw:px-6 tw:pt-[calc(3.5rem_+_var(--safe-top))] tw:font-sans`}
    >
      {/* No back arrow above this since 2026-10-05: the corner logo beside it
          goes to the library too (BackLink.tsx § `HomeLink`). The 3.5rem above
          is what keeps the heading clear of that logo, which is 2.75rem tall. */}
      <h1 className="tw:m-0 tw:font-prose tw:text-2xl tw:leading-snug tw:text-foreground">Profile</h1>
      {/* Three things now, and the sentence names all three: what the model is
          told, what your account may do, and what you have switched on. It used
          to name only the first, which was the whole page until Settings landed;
          the plan arrived on 2026-09-03. A sentence that keeps describing two of
          three sections is the kind of small untruth that is nobody's job to
          notice. */}
      <p className="tw:mt-2 tw:mb-0 tw:text-sm tw:text-muted-foreground">
        What the model knows about who it is writing for, what your account may do, and what you
        have switched on.
      </p>

      {/* **Which sections fold, and which do not.** Greg, 2026-10-03, feedback
          report `spya-ka3cau`:

          > So the important ones that we should keep open are probably account,
          > plan, and about you. And then I think the others could perhaps be
          > default collapsed.

          So the first three are **not collapsible at all** rather than merely
          open: a heading that can be shut is a card that can be hidden, and
          *Plan* is where the quota's refusal sends a reader for a button. The
          other three are `collapsible`, which starts them shut.

          None is `keepMounted`. Settings' saves live outside the component
          (experimental-store.ts) or on the device (AppearanceSetting), so
          unmounting it cancels nothing; the two read-outs are fed by fetches
          this page owns, above, which run whether or not their card is drawn.
          GPT Sol, plan review of 261003k, F4.

          `keywords` are for the contents list's search box (PageContents.tsx,
          mounted above): the words a reader would type, not the ones each
          card prints.
          docs/project/reader-profile.md § The page's six sections. */}
      {/* ---------------------------------------------------------- account -- */}
      <Section
        icon={UserCheck}
        label="Account"
        keywords="email address signed in as sign out log out logout login who am I"
      >
        <div className={`${CARD} tw:p-4`}>
          <AccountSection />
        </div>
      </Section>

      {/* ---------------------------------------------------------- plan -- */}
      {/* **Directly under the account, above everything else.** It is the other
          half of "who am I here" — the address you signed in with, and what that
          account may do — and it is the page the refusal copy sends people to
          when the wall stops them (`ingestQuotaReached`, src/messages.ts), so it
          must not be below three cards they have to scroll past. */}
      <Section
        icon={Wallet}
        label="Plan"
        keywords="upgrade billing subscription pay payment price cost tier free limit quota allowance articles a month stripe cancel switch"
      >
        <div className={`${CARD} tw:p-4`}>
          <BillingSection />
        </div>
      </Section>

      {/* ------------------------------------------------------- about you -- */}
      <Section
        icon={User}
        label="About you"
        keywords="background expertise interests bio who I am what the model knows personalise tailor reader profile"
      >
        <div className={`${CARD} tw:p-4`}>
          <ProfileBox
            id="reader-profile"
            label="Your background, expertise and interests"
            placeholder="e.g. Cognitive scientist, twenty years. Rusty on transformer internals. I read for the argument rather than the news."
            hint="Used on every article — the glossary, the ideas, chat, explanations and threads. It changes what gets explained and how much, never what the article says."
            value={profile.draft}
            onChange={profile.setDraft}
            onCommit={profile.commit}
            max={MAX_PROFILE_CHARS}
            disabled={profile.saved === null}
            rows={5}
            /* Saved, and said — by the box. A save that fails while the box
               goes on showing what you typed is the whole hazard here: the
               profile you believe every glossary is written to is a string the
               server never got. */
            save={profile.state}
            inFlight={profile.inFlight}
          />
          <p className="tw:mt-3 tw:mb-0 tw:text-xs tw:text-ink-faint">
            Changing this can give existing personalised text the person-and-pencil icon. Nothing
            is regenerated on its own — where a mode can replace its result, its panel offers to.
          </p>
        </div>
      </Section>

      {/* --------------------------------------------------------- settings -- */}
      {/* **Below "about you", above everything that is only a read-out.** The
          two boxes above are what the model is told; this is what the app does.
          Both are things the reader sets, so they belong together and ahead of
          "recently read" and "what's running", neither of which is a control.
          docs/project/experimental-features.md. */}
      <Section
        icon={SlidersHorizontal}
        label="Settings"
        keywords="theme dark mode light mode system appearance colour color night experimental features beta preferences options switch toggle"
        collapsible
      >
        <div className={`${CARD} tw:flex tw:flex-col tw:gap-4 tw:p-4`}>
          <AppearanceSetting />
          <SettingsSection />
        </div>
      </Section>

      {/* ---------------------------------------------------- recently read -- */}
      <Section
        icon={BookOpen}
        label="Recently read"
        keywords="history recent articles last opened shelf library how many words count"
        collapsible
      >
        <div className={`${CARD} tw:divide-y tw:divide-border tw:overflow-hidden`}>
          {shelf === null ? (
            /* `role="status"` because the sentence arrives 600ms after the
               card does; the non-breaking space holds the line's height until
               it does, so the card does not grow underneath the reader. */
            <p
              className="tw:m-0 tw:px-4 tw:py-3 tw:text-sm tw:text-muted-foreground"
              role="status"
            >
              {slowShelf ? "Fetching your shelf…" : "\u00a0"}
            </p>
          ) : shelf === "error" ? (
            <p className="tw:m-0 tw:px-4 tw:py-3 tw:text-sm tw:text-muted-foreground">
              Couldn't load your shelf. Reload to try again.
            </p>
          ) : recent.length === 0 ? (
            <p className="tw:m-0 tw:px-4 tw:py-3 tw:text-sm tw:text-muted-foreground">
              Nothing on the shelf yet.
            </p>
          ) : (
            recent.map((a) => (
              <Link
                key={a.slug}
                href={readHref(a.slug)}
                className="tw:flex tw:items-baseline tw:justify-between tw:gap-4 tw:px-4 tw:py-2.5 tw:text-sm tw:no-underline tw:hover:bg-muted/40"
              >
                <span
                  className={withVoice(
                    "tw:truncate tw:text-foreground",
                    articleTitleVoice(Boolean(a.titleOverridden)),
                  )}
                >
                  {a.title}
                </span>
                <span className="tw:shrink-0 tw:text-xs tw:text-ink-faint">
                  {a.minutes ? `${a.minutes} min` : ""}
                </span>
              </Link>
            ))
          )}
        </div>
        {/* `Array.isArray`, not `!== null`: a failed fetch would otherwise put
            "0 on the shelf" under the sentence saying we could not reach it. */}
        {Array.isArray(shelf) && (
          <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-ink-faint">
            {/* The cap, said. Not "showing 8" — showing 8 *of* how many, so the
                number you are not seeing is visible too. */}
            {onShelf.length > RECENT
              ? `The ${RECENT} most recent of ${onShelf.length} on the shelf`
              : `${onShelf.length} on the shelf`}
            {words > 0 && ` · ${words.toLocaleString()} words, not counting notes`}
          </p>
        )}
      </Section>

      {/* -------------------------------------------------- what is running -- */}
      <Section
        icon={Cpu}
        label="What's running"
        keywords="models AI which model LLM provider claude sonnet opus openrouter effort why is it slow"
        collapsible
      >
        <div className={`${CARD} tw:divide-y tw:divide-border tw:overflow-hidden`}>
          {models === null ? (
            <p className="tw:m-0 tw:px-4 tw:py-3 tw:text-sm tw:text-muted-foreground">Loading…</p>
          ) : models === "error" ? (
            <p className="tw:m-0 tw:px-4 tw:py-3 tw:text-sm tw:text-muted-foreground">
              Couldn't reach the server to ask what it is running.
            </p>
          ) : (
            models.map((m) => (
              <div
                key={m.task}
                className="tw:flex tw:items-baseline tw:justify-between tw:gap-4 tw:px-4 tw:py-2 tw:text-sm"
              >
                <span className="tw:text-muted-foreground">{m.task}</span>
                {/* The name, then the two things that qualify it, both faint.
                    `title` carries the exact string sent, because the name on
                    screen is deliberately not that string — src/models.ts § the
                    third spelling. */}
                <span
                  className="tw:font-mono tw:text-xs tw:text-foreground"
                  title={`${m.id} · via ${ownLabel(PROVIDER_LABEL, m.provider) ?? m.provider}${m.wire ? ` · ${ownLabel(WIRE_LABEL, m.wire) ?? m.wire} API` : ""}`}
                >
                  {m.model}
                  {m.effort && <span className="tw:text-ink-faint"> · {m.effort}</span>}
                  <span className="tw:text-ink-faint">
                    {" · "}
                    {ownLabel(PROVIDER_LABEL, m.provider) ?? m.provider}
                    {/* Only when the server names one. This printed
                        "(undefined)" on every row until 2026-10-03: the
                        route had never sent the field. */}
                    {m.wire && ` (${ownLabel(WIRE_LABEL, m.wire) ?? m.wire})`}
                    {/* An override is a one-off comparison somebody is running,
                        not this app's configuration, and the difference matters
                        to anyone reading the table to find out what the app
                        does. */}
                    {m.source === "override" && " · set in the environment"}
                  </span>
                </span>
              </div>
            ))
          )}
        </div>
        <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-ink-faint">
          Which model writes what, and which way we reach it. Nothing here is a setting — it is what
          the server is configured with, shown so that "why is the glossary slower than the
          ideas" has an answer.
        </p>
      </Section>

      {/* **Where a signed-in reader finds the policy.** The landing page's
          footer is the other one, and a reader who signed in months ago will
          never see that again. Here rather than in the masthead because it is
          not something anybody needs mid-article — it is a thing you go and
          look up, and this is the page you already come to for "what does this
          know about me".

          It was a hand-written Privacy link until 2026-09-03 and is now the
          same row every other page carries (SiteFooter.tsx). The sentence it
          used to end with — *"what we keep, and who it goes to"* — went with
          it: the row is four links across every page, and one of them wearing a
          gloss the others do not have reads as a different kind of thing. */}
      <SiteFooter />
    </main>
    </>
  );
}
