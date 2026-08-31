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
 * Not here, and each was considered rather than forgotten: **expertise
 * sliders** (the original's beginner/intermediate/expert axis, rejected twice
 * in this repo — the free-text box above *is* the single global setting its own
 * doc recommended instead); **typography settings** (*"a reader who wants
 * bigger text has a browser zoom"*); **a difficulty score**, for the reason
 * docs/plans/metadata-page.md gives; and **streaks or anything that counts at you**, which
 * the original's homepage did not have either. This is a reading tool.
 */
import { useEffect, useState } from "react";
import { ArrowLeft, BookOpen, Cpu, TriangleAlert, User, UserCheck } from "lucide-react";
import { MAX_PROFILE_CHARS, type LibraryEntry } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { Link } from "./Link.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { readHref } from "./router.js";
import { AccountSection } from "./AccountSection.js";
import { ProfileBox } from "./ProfileBox.js";
import { useProfile } from "./useProfile.js";
import { useSlow } from "./useSlow.js";

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
  wire: string;
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
 * itself, not be swallowed.
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

export function ProfilePage() {
  useDocumentTitle(pageTitle({ kind: "profile" }));

  const profile = useProfile();
  const [shelf, setShelf] = useState<LibraryEntry[] | "error" | null>(null);
  const [models, setModels] = useState<ModelRow[] | "error" | null>(null);
  /* The card below stands in place of the list, so it follows the same rule the
     panels do: nothing for the first 600ms, because a line that appears and
     vanishes reads as breakage. useSlow.ts. */
  const slowShelf = useSlow(shelf === null);

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
    <main className="tw:mx-auto tw:max-w-3xl tw:px-6 tw:pt-[calc(3.5rem_+_var(--safe-top))] tw:pb-24 tw:font-sans">
      <Link
        href="/"
        className="tw:mb-6 tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-ink-faint tw:no-underline tw:hover:text-highlight"
      >
        <ArrowLeft size={13} />
        Back to the shelf
      </Link>

      <h1 className="tw:m-0 tw:font-prose tw:text-2xl tw:leading-snug tw:text-foreground">Profile</h1>
      <p className="tw:mt-2 tw:mb-0 tw:text-sm tw:text-muted-foreground">
        What the model knows about who it is writing for.
      </p>

      {/* ---------------------------------------------------------- account -- */}
      <Section icon={UserCheck} label="Account">
        <div className={`${CARD} tw:p-4`}>
          <AccountSection />
        </div>
      </Section>

      {/* ------------------------------------------------------- about you -- */}
      <Section icon={User} label="About you">
        <div className={`${CARD} tw:p-4`}>
          <ProfileBox
            id="reader-profile"
            label="Your background, expertise and interests"
            placeholder="e.g. Cognitive scientist, twenty years. Rusty on transformer internals. I read for the argument rather than the news."
            hint="Used on every article — the glossary, the ideas, chat, explanations and threads. It changes what gets explained and how much, never what the article says."
            value={profile.draft}
            onChange={profile.setDraft}
            onCommit={profile.flush}
            max={MAX_PROFILE_CHARS}
            disabled={profile.profile === null}
            rows={5}
          />
          {/* Saved, and said. A save that fails while the box goes on showing
              what you typed is the whole hazard here — the profile you believe
              every glossary is written to is a string the server never got. */}
          <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-ink-faint" aria-live="polite">
            {profile.error ? (
              <span className="tw:inline-flex tw:items-center tw:gap-1 tw:text-highlight">
                <TriangleAlert size={12} /> Not saved — {profile.error}
              </span>
            ) : profile.saving ? (
              "Saving…"
            ) : profile.profile === null ? (
              "Loading…"
            ) : (
              "Saved when you click away, or with ⌘↵."
            )}
          </p>
          <p className="tw:mt-3 tw:mb-0 tw:text-xs tw:text-ink-faint">
            Changing this marks everything already written as{" "}
            <em className="tw:not-italic tw:text-muted-foreground">written for an older profile</em>
            . Nothing is regenerated on its own — each panel offers to rewrite when you want it.
          </p>
        </div>
      </Section>

      {/* ---------------------------------------------------- recently read -- */}
      <Section icon={BookOpen} label="Recently read">
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
                <span className="tw:truncate tw:text-foreground">{a.title}</span>
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
      <Section icon={Cpu} label="What's running">
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
                  title={`${m.id} · via ${PROVIDER_LABEL[m.provider] ?? m.provider} · ${WIRE_LABEL[m.wire] ?? m.wire} API`}
                >
                  {m.model}
                  {m.effort && <span className="tw:text-ink-faint"> · {m.effort}</span>}
                  <span className="tw:text-ink-faint">
                    {" · "}
                    {PROVIDER_LABEL[m.provider] ?? m.provider}
                    {` (${WIRE_LABEL[m.wire] ?? m.wire})`}
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
    </main>
  );
}

/** Same heading treatment as the metadata page, so the two read as one app. */
function Section({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof User;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="tw:mt-8">
      <h2 className="tw:m-0 tw:mb-3 tw:flex tw:items-center tw:gap-2 tw:text-[0.68rem] tw:font-normal tw:uppercase tw:tracking-[0.09em] tw:text-ink-faint">
        <Icon size={12} />
        {label}
      </h2>
      {children}
    </section>
  );
}
