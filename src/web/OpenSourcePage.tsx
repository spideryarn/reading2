/**
 * `/opensource` — the code is public, here is where it is and what you may do
 * with it.
 *
 * Greg, 2026-09-07:
 *
 * > create a brief /opensource page in the footer with links to/from various
 * > other pages, using GitHub logo to indicate.
 *
 * *Brief* is the instruction, so this is four short sections and a row of
 * links, and it takes `ContactPage.tsx`'s shape rather than the marketing
 * shell — a Back link, an `h1`, prose, and the same `SiteFooter` every page a
 * reader lands on carries. The reasoning for that choice is written out in
 * ContactPage.tsx § Why it looks like `/privacy`; it applies here unchanged.
 *
 * ## Everything on it is already true somewhere else
 *
 * The repository, the MIT licence, the *"tell me first, and bring the prompts"*
 * condition on pull requests, and the fact that most of this codebase was
 * written by AI agents are all in [README.md](../../README.md) § Contributing
 * and § Working here, which is the doc that owns them. This page is the
 * reader-facing half-page of the same facts, and it must not acquire a fifth
 * one of its own — a claim that appears only here is a claim nothing else can
 * check. documentation-policy.md § one home per fact.
 *
 * **`REPO_URL` is imported rather than typed**, for the reason
 * `src/site-text.ts` exists for the contact address: the changelog links every
 * commit into that same repository, and two spellings of it is how the two come
 * to disagree after a rename.
 *
 * ## The one thing it does not say
 *
 * It does not say *"self-host it"* or lead with the setup commands. Everything
 * needed to run it is in the README and this page links there — but the reader
 * this page is written for is somebody deciding whether we can be trusted with
 * what they read, not somebody about to install Postgres. Greg's word was
 * "brief", and the way a brief page stops being brief is by trying to be a
 * second README.
 */
import { ArrowLeft } from "lucide-react";

import { REPO_URL } from "../changelog.js";
import { GitHubMark } from "./GitHubMark.js";
import { Link } from "./Link.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { CHANGELOG_HREF, PRIVACY_HREF } from "./router.js";
import { SiteFooter } from "./SiteFooter.js";

const OUT_CLASS = "tw:text-highlight tw:no-underline tw:hover:underline";

/** A link off the site, to somewhere in the repository. */
function Repo({ path, children }: { path: string; children: string }) {
  return (
    <a href={`${REPO_URL}${path}`} target="_blank" rel="noreferrer noopener" className={OUT_CLASS}>
      {children}
    </a>
  );
}

export function OpenSourcePage() {
  useDocumentTitle(pageTitle({ kind: "opensource" }));

  return (
    <main className="tw:mx-auto tw:max-w-2xl tw:px-6 tw:pt-[calc(3.5rem_+_var(--safe-top))] tw:pb-24 tw:font-sans">
      <Link
        href="/"
        className="tw:mb-6 tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-ink-faint tw:no-underline tw:hover:text-highlight"
      >
        <ArrowLeft size={13} />
        Back
      </Link>

      <h1 className="tw:m-0 tw:flex tw:items-center tw:gap-2.5 tw:font-prose tw:text-2xl tw:leading-snug tw:text-foreground">
        <GitHubMark size={22} className="tw:shrink-0 tw:text-ink-faint" />
        Open source
      </h1>

      <div className="tw:mt-5 tw:flex tw:flex-col tw:gap-4 tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
        <p className="tw:m-0">
          Spideryarn is built in the open. All of the code behind this site — the reading view, the
          pipeline that turns an article into something you can zoom around, the deployment scripts
          — lives at{" "}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className={`${OUT_CLASS} tw:inline-flex tw:items-center tw:gap-1.5`}
          >
            <GitHubMark size={13} />
            spideryarn/reading2
          </a>{" "}
          and is free to read, copy and change under the{" "}
          <Repo path="/blob/main/LICENSE">MIT licence</Repo>.
        </p>

        <p className="tw:m-0">
          The reasoning is public too, and it is the more interesting half. Every piece of work
          keeps a plan saying what was decided and what simpler thing was passed over; every bug
          worth understanding gets a write-up naming the class it belongs to. Those are in{" "}
          <Repo path="/tree/main/docs">the docs folder</Repo>, alongside{" "}
          <Repo path="/blob/main/docs/project/vision.md">the vision doc</Repo>, which says what this
          is for and — more usefully — what it is deliberately not.
        </p>

        <p className="tw:m-0">
          <strong className="tw:font-medium tw:text-foreground">
            Most of it was written by AI agents
          </strong>
          , which is why the documentation reads the way it does: intent is the scarce thing in a
          codebase where the code is cheap. If you want to contribute, the{" "}
          <Repo path="/blob/main/README.md#contributing">README</Repo> says how — and the most
          useful contribution is not code but a well-described report of something that went wrong
          while you were reading.
        </p>

        {/* **This paragraph said something false for an hour, and it is the
            reason to be careful here.** The first draft was *"Being able to read
            the code is not the same as being able to read your data, and nobody
            can"* — which contradicts our own privacy page, in the same breath as
            linking to it: `/privacy` says *"Spideryarn is beta software run by
            one person — assume we can see what's in it"*, and there is an
            administrator view across owners (admin.md). GPT Sol's review, P1.

            Publishing the source publishes the source. That is the true and
            narrower claim, and it is the one worth making — because a reader who
            hears "open source" may reasonably wonder whether their articles are
            in the repository too. */}
        <p className="tw:m-0">
          Publishing the code does not publish anything you have read or written — none of that is
          in the repository. What we keep, who can see it and what we send to AI providers is on the{" "}
          <Link href={PRIVACY_HREF} className={OUT_CLASS}>
            privacy page
          </Link>
          , and it is the honest answer rather than the reassuring one. What has shipped, release by
          release, is on{" "}
          <Link href={CHANGELOG_HREF} className={OUT_CLASS}>
            What’s new
          </Link>{" "}
          — where every release links to the exact commit it was built from.
        </p>
      </div>

      <SiteFooter />
    </main>
  );
}
