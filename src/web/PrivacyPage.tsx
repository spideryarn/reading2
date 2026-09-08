/**
 * `/privacy` — what we keep, where it goes, and what you can ask us to do
 * about it.
 *
 * Greg asked for it on 2026-09-02: *"let's aim to be clear about what we
 * store/process and why, and what models & third-parties/subprocessors etc …
 * brief/concise, and written very plainly, with some high-level, important
 * protections for us as you see fit (but without filling it with legalese)."*
 * docs/project/privacy.md is the doc, and holds the decisions behind the
 * wording — including the four Greg made when asked.
 *
 * ## Prose in JSX, and not a markdown file
 *
 * LandingPage.tsx is the precedent and it is the only other page in the app
 * that is a wall of public-facing prose. A markdown file rendered at build time
 * was the alternative and it was weighed: `mdast-util-from-markdown` *is*
 * installed, but the renderer over it is Cited.tsx, which exists to turn
 * `spya-…` references into links into an article and knows about citations,
 * modes and a block index. Reaching for it here would braid the privacy page
 * into the chat renderer, and writing a second small renderer is a second
 * mechanism. So: JSX, like the front door.
 *
 * ## Everything on this page has to be true of the code
 *
 * That is the live cost of the file, exactly as it is for LandingPage.tsx —
 * which claimed "six diagrams" for a day, from a doc, when there were four. A
 * privacy policy is worse than a landing page to get wrong, because the reader
 * cannot check it and is relying on us to have.
 *
 * So the model names are **held to src/models.ts and src/live.ts by
 * tests/privacy-page.test.ts**, which reads this file as text and fails naming
 * it when a model is added or swapped. Importing those two constants directly
 * would be better still and is not available: both are server modules and the
 * client's import graph is asserted closed (tests/client-imports.test.ts).
 *
 * The rest — the regions, the retention windows, who the subprocessors are — is
 * prose that a person has to re-read, and docs/project/privacy.md lists
 * what to go and look at when any of it moves. Two claims in the first draft
 * were already false when written, and the comments beside them say which.
 */
import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";

import { TAKEDOWN_HEADING } from "../messages.js";
import { CONTACT_EMAIL } from "../site-text.js";
import { Link } from "./Link.js";
import { PUBLIC_SHARING_HREF, TAKEDOWN_SECTION_ID } from "./router.js";
import { SiteFooter } from "./SiteFooter.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";

/**
 * The date this wording last changed, and the whole of our versioning.
 *
 * A one-line "the date at the top is the version" is what a policy this size
 * can honestly promise: there is no changelog, no diff view and nobody to email
 * about a wording change during a beta. Bump it when you change the words.
 */
const LAST_UPDATED = "7 September 2026";

/**
 * A heading and its paragraphs. Eight of them; nothing else on the page.
 *
 * `id` is optional and exactly one section has one: the takedown section, which
 * is linked into from the two public visitor surfaces. `scroll-mt` so that a
 * section scrolled to does not end up under the top bar.
 */
function Section({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="tw:mt-8 tw:scroll-mt-20">
      <h2 className="tw:m-0 tw:mb-2 tw:font-prose tw:text-lg tw:leading-snug tw:text-foreground">
        {title}
      </h2>
      <div className="tw:flex tw:flex-col tw:gap-3 tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

/** One row of the subprocessor list: who, what for, and where they are. */
function Third({ name, href, children }: { name: string; href: string; children: React.ReactNode }) {
  return (
    <li className="tw:mb-2">
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="tw:text-highlight tw:no-underline tw:hover:underline"
      >
        {name}
      </a>{" "}
      — {children}
    </li>
  );
}

/**
 * **Arriving at `/privacy#if-something-here-is-yours` has to move the page**,
 * and nothing else in the app would do it.
 *
 * `navigate` (router.ts) pushes the address and then scrolls to the top on every
 * navigation, because arriving halfway down a new page reads as a rendering bug
 * — and that is the right default for the other twenty links in the app. A cold
 * load does not rescue it either: the browser honours a fragment against the
 * document it parsed, and this page is rendered by React afterwards, so there is
 * nothing under that id when it looks. Without these six lines the takedown link
 * lands a rightsholder at the top of a long privacy policy with no indication of
 * where to look, and nothing anywhere reports that it did.
 *
 * **One id, not a general fragment router.** There is exactly one anchor on this
 * page and this is it; a `location.hash.slice(1)` lookup would be a mechanism
 * for a feature nobody has asked for, and would happily scroll to anything a
 * pasted address named.
 *
 * `?.` on the call because jsdom has no `scrollIntoView` — the same reason
 * PricingPage.tsx guards its own. tests/takedown-privacy-section.test.tsx
 * drives both arms.
 */
function useTakedownFragment(): void {
  useEffect(() => {
    if (location.hash !== `#${TAKEDOWN_SECTION_ID}`) return;
    document.getElementById(TAKEDOWN_SECTION_ID)?.scrollIntoView?.({ block: "start" });
  }, []);
}

export function PrivacyPage() {
  useDocumentTitle(pageTitle({ kind: "privacy" }));
  useTakedownFragment();

  return (
    <main className="tw:mx-auto tw:flex tw:min-h-dvh tw:max-w-2xl tw:flex-col tw:px-6 tw:pt-[calc(3.5rem_+_var(--safe-top))] tw:font-sans">
      {/* **"Home", not "Back", since 2026-09-08.** It goes to `/` rather than
          `history.back()`, and most people who open this page were *sent* to it
          — from an email, from the footer of another page, from a link in an
          article — so there was often no "back" for it to mean. It is also the
          label the footer uses for the same destination, and one page should not
          call one address two things. */}
      <Link
        href="/"
        className="tw:mb-6 tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-ink-faint tw:no-underline tw:hover:text-highlight"
      >
        <ArrowLeft size={13} />
        Home
      </Link>

      <h1 className="tw:m-0 tw:font-prose tw:text-2xl tw:leading-snug tw:text-foreground">
        Privacy
      </h1>
      <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-ink-faint">
        Last updated {LAST_UPDATED}. The date is the version — we change this page rather than
        numbering it.
      </p>

      {/* **The summary paragraph, and it is not decoration.** Regulators ask
          for "concise, transparent, intelligible" and every short policy worth
          copying opens this way. Somebody who reads only this box should come
          away with the two facts that would actually surprise them: the
          article goes to a model provider, and we can see what is in here. */}
      <p className="tw:mt-5 tw:mb-0 tw:rounded-md tw:border tw:border-rule tw:bg-surface-raised tw:p-4 tw:text-sm tw:leading-relaxed tw:text-foreground">
        The short version: we keep your account, the articles you add and everything you write about
        them, so that we can show it back to you. To make the summaries, answers and diagrams, we
        send the article and your questions to AI providers. We don’t sell any of it, we don’t show
        ads, and nobody trains a model on it. Spideryarn is beta software run by one person — assume we
        can see what’s in it.
      </p>

      <Section title="Who we are">
        <p>
          Spideryarn is an experiment in AI-assisted reading, built and run by one person in London,
          United Kingdom. For anything on this page — a question, a correction, a request to delete
          your data — write to{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="tw:text-highlight tw:no-underline tw:hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>

      <Section title="What we keep">
        <ul className="tw:m-0 tw:list-disc tw:pl-5">
          <li className="tw:mb-2">
            <strong className="tw:text-foreground">Your account</strong> — your email address, an
            internal account id, which sign-in methods you have linked, and when the account was
            made and last used. If you sign in with Google we get the basic profile information
            Google hands over; we never see your Google password.
          </li>
          <li className="tw:mb-2">
            <strong className="tw:text-foreground">The articles you add</strong> — we fetch the page
            you point us at and store its text and images. A PDF you upload is stored as a file.
          </li>
          <li className="tw:mb-2">
            <strong className="tw:text-foreground">What you write</strong> — notes, comments,
            highlights, chat and voice conversations, saved searches, and the “about you” profile
            you can fill in, which is there to be given to the model. Quiz answers are the exception:
            they go to a model to be marked and are not stored.
          </li>
          <li className="tw:mb-2">
            <strong className="tw:text-foreground">What the models make for you</strong> —
            summaries, outlines, glossaries, diagrams and search indexes, kept so that we don’t have
            to pay to make them twice.
          </li>
          <li className="tw:mb-2">
            <strong className="tw:text-foreground">A record of every model call</strong> — which
            model, how many tokens, what it cost. That record does not contain what was said.
          </li>
          <li className="tw:mb-2">
            <strong className="tw:text-foreground">Bug reports</strong> — what you write in the
            Feedback box, and what comes with it. That has a section of its own below, because it
            is the one place you hand us something we did not already have.
          </li>
          <li>
            <strong className="tw:text-foreground">Ordinary server logs</strong> — the method and
            address of a request, the status we answered with, how long it took, and errors. Not the
            answer itself: article text and the things you write are deliberately kept out.
          </li>
        </ul>
        {/* **What is in the browser, and the first draft got it wrong.** It
            said "the only thing stored in your browser is what keeps you
            signed in" — and src/web/lib/offline-store.ts keeps a whole
            IndexedDB cache of article bodies so that losing your connection
            does not lose your article. It is on the reader's own machine, and
            it is still the reader's business: it is why signing out on a
            shared iPad matters. That store is keyed by reader id and drops
            that account's rows on sign-out, which is the sentence below. */}
        <p>
          There are no advertising or analytics trackers on this site, and no third-party cookies.
          What your browser keeps is the thing that signs you in, a few preferences like which
          microphone you picked, and a copy of the articles you have opened, so that losing your
          connection doesn’t lose your reading. That copy is dropped when you sign out — worth
          knowing on a shared computer.
        </p>
      </Section>

      <Section title="Where it goes">
        {/* **"The site runs from London" was too broad**, and GPT Sol was
            right about it: `vercel.json` pins the *functions* to `lhr1`, and
            every request still reaches them across Vercel's global network,
            which also serves the static files. The database, the files and the
            code that touches them are the part that is really in London. */}
        <p>
          The database, your uploaded files and the code that reads them are in{" "}
          <strong className="tw:text-foreground">London</strong>. Requests reach us across Vercel’s
          worldwide network, which also serves the page itself. The AI providers are mostly in the
          United States, so anything you send to a model leaves the UK.
        </p>
        <ul className="tw:m-0 tw:list-disc tw:pl-5">
          <Third name="Supabase" href="https://supabase.com/privacy">
            the database and file storage, and sign-in. London (eu-west-2).
          </Third>
          <Third name="Vercel" href="https://vercel.com/legal/privacy-policy">
            hosting. The code that answers your requests runs in London; their request logs are kept
            about a day.
          </Third>
          <Third name="OpenRouter" href="https://openrouter.ai/privacy">
            every AI call but one goes through them, and they pick an upstream that serves the model
            we asked for. We prefer Anthropic for Claude, but fallbacks are allowed, so the upstream
            can be a cloud host such as AWS rather than the model’s maker.
          </Third>
          {/* **Two paths now, and they are genuinely different**, which is why
              this entry stopped saying "the live voice mode only" on
              2026-09-07. Live conversation is browser-to-OpenAI directly and
              never touches our server; dictation is server-to-OpenRouter-to-
              OpenAI and does. Collapsing them would make the strong claim in
              the first (the audio never reaches us) sound as if it covered the
              second, which it does not.
              docs/plans/260907c-dictation-onto-an-openai-transcriber.md. */}
          <Third name="OpenAI" href="https://openai.com/policies/privacy-policy">
            your voice, by two different routes. In the live voice mode your microphone connects
            straight from your browser to them, directly rather than through OpenRouter because
            nobody else routes a realtime connection; the audio never passes through our server, and
            the text of what was said comes back to us and is stored as part of the conversation.
            Dictation is the other route: there the recording goes from us to OpenRouter and on to
            OpenAI’s transcriber, and the paragraph below says what that means.
          </Third>
          <Third name="Google" href="https://policies.google.com/privacy">
            sign-in, if you choose the Google button.
          </Third>
          <Third name="Sentry" href="https://sentry.io/privacy/">
            error reports when something breaks, kept 30 days. If you are signed in these carry your
            account id and email address, so that a broken page has a person attached to it. Bug
            reports you file are copied here too.
          </Third>
          <Third name="Stripe" href="https://stripe.com/privacy">
            payments. <strong className="tw:text-foreground">Not switched on yet</strong> — named
            here because it is coming. Stripe will handle the card; we will never see it, and this
            page will say what we do keep before anybody is charged.
          </Third>
        </ul>
        <p>
          {/* **The honest version of the training question.** Everything here
              is checkable in the code, and until 2026-09-07 the checkable fact
              was `zdr: true` on dictation and nowhere else. It is now `zdr` on
              **nothing** (src/ai-call.ts § AI_JOB_ROUTE), so the sentence that
              used to end this paragraph has been replaced rather than softened.
              docs/project/ai-gateway.md § A key is not access. */}
          We do not sell your text, and we do not train anything on it. Neither do these providers,
          under the terms we use them on — but that is a setting on our account with OpenRouter as
          much as it is a line in our code, so treat it as a commitment we hold ourselves to rather
          than something the page can prove to you. What each provider keeps, and for how long, is
          governed by their own policy, and the links above are the authority on it.
        </p>
        <p>
          {/* **The paragraph that used to be one sentence, and the one place on
              this page where we tell a reader something got worse.**

              It said: *"Dictation is the one call we pin to upstreams that
              retain none of the content, because it carries your voice."* That
              was true of a Gemini chat model routed with `zdr: true`. Dictation
              moved to `openai/gpt-transcribe` on 2026-09-07 because it is the
              one model that takes a list of an article's own words, and
              **OpenRouter does not apply routing or `zdr` on its transcription
              endpoint** — an impossible `only: ["anthropic"]` answers 200 with
              a transcript, and so does `zdr: true` for a model absent from
              their ZDR list. Not the whole block: `provider.options` *is*
              forwarded, and is how the vocabulary gets there at all. So the
              guarantee is not merely unset, it is unreachable from this route;
              docs/plans/260907c-dictation-onto-an-openai-transcriber.md has the
              probe.

              Every factual clause below is quoted from a published policy and
              cited in docs/project/privacy.md § Where a reader's voice goes.

              **"its API customer", not "we".** On this route OpenRouter is
              OpenAI's API customer and we are OpenRouter's, so a sentence
              saying *we* have not opted in to OpenAI's training would be
              describing a setting that is not ours to hold. GPT Sol's third
              review. The OpenRouter clause above is the one where "ours" is
              correct, and it is marked as a commitment rather than as something
              this page can prove.
              **Do not warm this up.** The temptation is "and they say they keep
              nothing", which their own per-endpoint table does say — but
              `gpt-transcribe` is listed under two OpenAI endpoints with
              different retention, and nothing documents which one OpenRouter
              calls. That is precisely the unverifiable sentence this page
              exists not to contain. */}
          <strong className="tw:text-foreground">Dictation is the exception, and it changed.</strong>{" "}
          When you talk into a box here, the recording goes from us to OpenRouter and on to OpenAI’s
          <code className="tw:mx-1">gpt-transcribe</code>, because that is the route that will take a
          list of the words your article actually uses, which helps it spell names out of the piece
          you are reading. What each of them says is on their pages, linked above: OpenRouter says it
          does not store what passes through unless an account opts in — ours is not opted in, and
          that is a setting we hold ourselves to rather than something this page can prove — and that
          it keeps audio no longer than routing needs except where it says it must, for abuse
          detection, security, billing or the law; OpenAI says data sent to its API is not used to
          train its models by default, unless its API customer opts in.{" "}
          <strong className="tw:text-foreground">
            What changed is that we now rely on those policies rather than enforcing a
            zero-retention route.
          </strong>{" "}
          We used to route dictation so that only providers keeping nothing could serve it, and on
          this endpoint that setting is not applied, so we cannot. We do not save the recording on our
          servers — it arrives in one request, goes out in the next, and is gone when the request
          ends — and the fact that a request happened is still recorded.
        </p>
        {/* **The models, spelled out.** A privacy policy that says "an AI
            provider" and stops has told you nothing you could check, so this
            names every model an article or a question can reach.

            Typed here rather than imported: src/models.ts is a server module
            and the client may not import it (tests/client-imports.test.ts).
            The drift that would otherwise follow is caught instead by
            tests/privacy-page.test.ts, which reads this file and asserts that
            every name in `DISPLAY_NAME` — the inventory of every id this app
            can send — plus the two live-conversation models are somewhere in
            it. Add a model, and that test tells you this page is out of date. */}
        <p className="tw:text-xs tw:text-ink-faint">
          The default models, as of the date above: <code>claude-sonnet-5</code> for most of the reading
          aids, chat and search; <code>gpt-5.6-luna</code> for quick jobs and for reading PDFs;{" "}
          <code>voyage-4</code> to turn passages into the numbers that make search-by-meaning work;{" "}
          <code>gpt-transcribe</code> for dictation; and{" "}
          <code>gpt-realtime-2.1</code> with <code>gpt-live-transcribe</code> for the live voice
          mode.
        </p>
      </Section>

      <Section title="Who can see your shelf">
        <p>
          Your articles and notes are yours. Another reader signed into Spideryarn cannot see them.
        </p>
        {/* **Rewritten 2026-09-04, and the sentence that went said "Your notes,
            your comments and your conversations are not shared".** Two of those
            three now are: a shared link carries the reader's comments, what
            they wrote, and what the model answered. Greg's decision.
            docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3.

            **Conversations are still true and are said separately**, rather
            than being quietly dropped along with the other two. A reader who
            read the old sentence should be able to find out which half of it
            survived; a page that just stopped mentioning conversations would
            leave them guessing.

            The list of what goes out is deliberately *not* exhaustive here —
            the Access & Sharing card derives the full inventory at the moment
            of sharing (src/web/shared-inventory.ts), and two lists of the same
            thing is how one of them goes stale. This says the shape of it and
            points at the card. */}
        <p>
          Two exceptions, and both are worth knowing. If you mark an article{" "}
          <strong className="tw:text-foreground">public</strong>, anyone can read it without signing
          in, and it is listed publicly where somebody who was never sent the link can find it —
          that is what the setting is for. They get the article, its outline,
          its arc, the glossary, the ideas, the quotes, the timeline and the thread, some of which
          the model wrote knowing what your profile says about you, even though the profile itself
          is not shared.{" "}
          <strong className="tw:text-foreground">They also get your comments and your searches</strong>
          {" "}— the passages you marked, what you wrote about them, what the model answered when you
          asked, and the questions you put to the piece along with the passages they found. They can
          read all of that and add none of it. Your chat conversations are not shared, and neither
          is your profile. The
          sharing card lists exactly what will go out before you turn it on. And{" "}
          <strong className="tw:text-foreground">we can see what is in the app</strong>: there is an
          administrator’s view across all accounts, and we may read your articles and what you have
          written in order to fix a bug or make the thing better. We won’t sell it, publish it, or
          feed it to a model’s training.
        </p>
      </Section>

      {/* **The third false claim, and the worst of them.** The page said
          "delete an article and it goes". The button calls `shelf.archive`
          (ShelfEntry.tsx), which sets `archived_at` and destroys nothing — the
          article is restorable under "Show archived" and every artefact stays.
          GPT Sol found it by reading the button rather than the sentence, which
          is the only way it could have been found.

          **On 2026-09-04 the button was renamed to match**, so this section no
          longer has to explain away a word: it says what Archive does, and then
          answers the question that word leaves open — how to have an article
          actually erased. docs/project/library.md § Archive, and Undo is the
          confirmation.

          The list of what survives a *real* erasure is longer than the two
          things the second draft named, and Sol enumerated it against the
          schema: `article_visibility_changes`, `realtime_sessions`, `ai_calls`
          and `feedback` all keep a slug or an owner id, and `raw_sources` keeps
          the bytes. Rather than list five tables at a reader, the page groups
          them honestly and says the shape of it.

          **This section is the one to rewrite first when account deletion is
          built.** docs/project/website-text.md § What is pinned by a test. */}
      {/* **Greg asked for this section by name**, 2026-09-02: *"Add a minimal
          note to the /privacy page to have a section on what we store if they
          provide Feedback (with/out the optional extra diagnostics)."*

          It is a section rather than a longer bullet because the Feedback box
          is the one place in the app where a reader hands us something we did
          not already have, and because two of the four facts in it are ones a
          reader would be annoyed to discover afterwards: the address goes up
          whole, and the tick-box does not cover the screenshot.

          docs/project/privacy.md § What a bug report carries is the reasoning,
          and src/db/schema.ts is where the two consents are actually enforced —
          one by a CHECK, one by the fact that you have to paste a picture for
          there to be one. */}
      <Section title="If you send us a bug report">
        <p>
          The Feedback button sends us what you write, your email address, the build you were
          running and the address of the page you were on — the whole address, including anything
          after the <code>?</code>, so if you were searching for something, that search text comes
          with it. It goes to our database and to Sentry, and the point of saying so here is that
          you can leave the box until you are on a page you don’t mind us seeing.
        </p>
        <p>
          Two things are optional, and they are optional in different ways.{" "}
          <strong className="tw:text-foreground">A screenshot</strong> is included only if you paste,
          drop or choose one — the act of adding it is the whole of the choice, and it will contain
          whatever else was on your screen at the time.{" "}
          <strong className="tw:text-foreground">Browser diagnostics</strong> — recent errors, what
          your browser is, what the page was doing — are included only if you tick “send extra
          diagnostics”. If you leave that unticked, they are never collected in the first place, and
          our database refuses to store them.
        </p>
        <p>
          What a bug report never carries is the text of the article you were reading, or your notes
          on it. The diagnostics name paragraphs by their id, not by their words.
        </p>
      </Section>

      <Section title="Deleting things">
        <p>
          The <strong className="tw:text-foreground">Archive</strong> button on your shelf takes an
          article off the shelf and out of your library search, and you can bring it back at any
          time under “Show archived”. Nothing is destroyed, and your notes on it are still there.
          There is no button that really erases an article — undo matters more than tidiness — so if
          you want one actually gone, email us and we will do it.
        </p>
        <p>
          If you had shared an article and then archive it, it stops being listed anywhere public —
          but the link you gave out still opens it. Archiving is about your shelf; sharing is about
          the link. To close the link, use{" "}
          <strong className="tw:text-foreground">Stop sharing</strong> on the article’s own page.
        </p>
        <p>
          Same for the account. There is no “delete my account” button yet; email us and we delete
          your shelf, your notes, your conversations and everything the models made for you. During
          the beta we do this by hand, and we’ll get to it within a month.
        </p>
        <p>
          Three kinds of thing outlive an erasure, and it is worth saying which. We keep the
          <strong className="tw:text-foreground"> record of what our model calls cost</strong>,
          which is how we know what running this costs — it holds the job, the model and the price,
          not what was said. We keep a
          <strong className="tw:text-foreground"> thin audit trail</strong>: that an article existed
          under a given name, when it was shared publicly, that a voice session happened. And we
          keep the <strong className="tw:text-foreground">original downloaded file</strong>, stored
          under a fingerprint of its own contents rather than under your name, so that if somebody
          else added the same document it is the same file and deleting your copy cannot take
          theirs. Backups and our providers’ own logs take a little longer to age out.
        </p>
      </Section>

      {/* **Why we are allowed to hold it, in one sentence rather than a
          table.** GPT Sol was right that a lawful basis belongs in privacy
          information and not in terms of service, and wrong that it needs a
          table to say so: the ICO's own guidance asks for it plainly, and there
          are only two bases here worth naming. The comment below used to claim
          the opposite and has been corrected.

          **Still missing, and it needs a decision rather than a sentence**: the
          safeguard for sending data to US providers (a link to a provider's
          consumer privacy policy is not a transfer mechanism), and an Article 9
          condition for the special-category material a reader may upload
          despite being asked not to. Both are in
          docs/project/privacy.md as open. */}
      <Section title="What you can ask for">
        <p>
          We hold this because you asked us to run Spideryarn for you, and because we need a working
          record of what the thing costs and whether it is broken. We don’t rely on you consenting
          to anything except the two tick-boxes you can see: extra diagnostics on a bug report, and
          your microphone.
        </p>
        <p>
          Under UK data protection law you can ask us for a copy of what we hold about you, ask us
          to correct it, ask us to delete it, ask us to stop or limit what we do with it, and ask
          for it in a form you can take elsewhere. Email{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="tw:text-highlight tw:no-underline tw:hover:underline"
          >
            {CONTACT_EMAIL}
          </a>{" "}
          — during the beta we do it by hand rather than with a button, and we’ll get to it within a
          month. If you think we’ve handled your data badly, you can complain to the{" "}
          <a
            href="https://ico.org.uk/make-a-complaint/"
            target="_blank"
            rel="noreferrer noopener"
            className="tw:text-highlight tw:no-underline tw:hover:underline"
          >
            Information Commissioner’s Office
          </a>
          . You don’t have to come to us first, though we’d rather have the chance to fix it.
        </p>
      </Section>

      {/* **The four protective paragraphs**, and there are only four on
          purpose. Governing law, limitation of liability and an age gate with
          machinery behind it belong in terms of service if they belong
          anywhere. **A legal basis does not** — an earlier draft of this
          comment lumped it in with them, and GPT Sol was right that privacy
          information is exactly where it goes. It is now a sentence in the
          section above.

          These four are operational advice rather than a transfer of
          liability, and it is worth being clear-eyed that they are not much
          protection on their own: there is no terms page and nothing anybody
          agrees to. What they cover is what would actually happen — somebody
          putting medical records into a beta, somebody adding an article they
          have no right to. docs/project/privacy.md § What protects us. */}
      <Section title="Some things to be clear about">
        <p>
          <strong className="tw:text-foreground">This is beta software.</strong> It changes weekly,
          it will sometimes break, and we may have to reset data while the design is still moving.
          Please don’t put anything genuinely sensitive into it — health records, financial details,
          passwords, other people’s private documents.
        </p>
        <p>
          <strong className="tw:text-foreground">What you add is your responsibility.</strong> When
          you point Spideryarn at an article we fetch and store it on your behalf, so please only add
          things you’re allowed to read and keep a copy of, and don’t add documents full of other
          people’s personal information.
        </p>
        <p>
          <strong className="tw:text-foreground">Spideryarn is not for children.</strong> You need to
          be 18 or over to have an account.
        </p>
        <p>
          <strong className="tw:text-foreground">This page will change.</strong> When it does we’ll
          update the date at the top. If something material changes we’ll say so in the app rather
          than leaving you to spot it.
        </p>
      </Section>

      {/* **The one section on this page written to somebody who does not have an
          account**, which is why it is last: everything above is addressed to a
          reader, and this is addressed to the author of something a reader
          added.

          **Greg chose "build a minimal takedown route" on 2026-09-04**, over
          doing nothing and over a form with a queue behind it. The reason it
          exists is that Spideryarn republishes the extracted text of somebody
          else's article: the owner ticks a box confirming they have the right
          to, that box moves responsibility onto them rather than checking
          anything, and the platform's actual protection is that plus a way for
          the wronged party to complain. `/read/public` turned "reachable by
          link" into "findable", which is when that stops being theoretical.

          **A section and not a route**, decided here rather than inherited. A
          page of its own costs an arm in `parseRoute`, a member of the `Route`
          union, a case in `page-title.ts`, two arms of `App.tsx` and a component
          — and, worse, a second public address saying things about what we do
          that has to stay true alongside this one. The words belong beside "What
          you add is your responsibility" two sections up, which is the same fact
          told to the other party, and beside "Deleting things", which is already
          "email us and we will do it by hand". Findability comes from the link
          rather than from the page's name: nobody has to guess that a rights
          complaint lives under Privacy, because the two places a stranger meets
          a republished article both carry `TAKEDOWN_LINK` pointing straight at
          this anchor (src/web/PublicPages.tsx, src/web/PublicLibraryPage.tsx).

          **What is deliberately not built**: no form, no table, no queue, no
          moderation view, and nothing that changes an article's visibility
          without a person deciding. The mechanism for taking something down is
          the owner's own sharing switch; an administrator's override of it is a
          much larger decision than this section.

          **Every sentence here is a promise about what we will actually do**, so
          it names one mailbox, one pair of hands and days rather than hours. The
          third paragraph exists because "taken down" means something narrower
          here than a complainant would assume, and finding that out afterwards
          is worse than being told. docs/project/privacy.md § If something here
          is yours. */}
      <Section id={TAKEDOWN_SECTION_ID} title={TAKEDOWN_HEADING}>
        <p>
          When somebody adds an article to Spideryarn we fetch it and keep a copy of the text so
          that they can read it here. If they turn sharing on, that copy becomes readable by anyone
          and is listed on our public shelf. We ask them to confirm they have the right to share it
          — that is a promise they make, not a check we run, because we have no way of knowing who
          owns a page we fetched.
        </p>
        <p>
          So if something of yours is here and you would rather it were not, write to{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="tw:text-highlight tw:no-underline tw:hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
          . Please include the address of the Spideryarn page it is on, where the piece was
          originally published, and a line about your connection to it. The first of those is the
          one we cannot work without: if a message doesn’t say which page it is about, all we can
          do is write back and ask. We will take a fair complaint at face value rather
          than asking you to prove anything first: we make the article private, which takes it off
          the public shelf and stops the shared link opening it, and then we come back to you.
        </p>
        <p>
          The limits are worth saying plainly. One person reads that mailbox and does this by hand,
          so expect days rather than hours, and there is nothing out of hours. Making an article
          private does not delete the reader’s own copy — they keep what they added, the way they
          keep anything else in their library — and it does nothing about wherever else the piece
          may have been copied to. If you want the copy erased as well, say so and we will do that
          too.
        </p>
        {/* **The signpost out, and it points the way it does on purpose.**
            Everything above is a promise about what we will do when somebody
            asks; the reasons they might be less unhappy in the first place —
            what actually goes out, the link back to their page, the fact that
            none of this is in a search engine — are on
            `/features/public-readable-sharing`, and neither page restates the
            other. docs/project/public-readable-sharing.md § the split.

            **Last in the section, not first.** Somebody who read this far came
            for the mailbox and now has it; a link offered above the address
            would be a page between them and the thing they came for. */}
        <p>
          If you want the fuller picture first —{" "}
          <Link
            href={PUBLIC_SHARING_HREF}
            className="tw:text-highlight tw:no-underline tw:hover:underline"
          >
            what we do with an article somebody has made public
          </Link>{" "}
          sets out what goes out, what stays linked to the original, and why none of these pages is
          in a search engine.
        </p>
      </Section>

      {/* The way back out, for a reader who arrived here from the landing page
          and now wants to know what the thing actually does. SiteFooter.tsx. */}
      {/* The spacer that puts the footer on the floor of a `min-h-dvh` flex
          column. It grows to nothing on a page this long and is here so the
          four bare pages have one shape rather than two; ContactPage.tsx, where
          it does the work, says why it is a spacer and not `mt-auto` on the
          footer. */}
      <div className="tw:flex-1" />

      <SiteFooter />
    </main>
  );
}
