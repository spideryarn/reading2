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
import { ArrowLeft } from "lucide-react";

import { CONTACT_EMAIL } from "../site-text.js";
import { Link } from "./Link.js";
import { SiteFooter } from "./SiteFooter.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";

/**
 * The date this wording last changed, and the whole of our versioning.
 *
 * A one-line "the date at the top is the version" is what a policy this size
 * can honestly promise: there is no changelog, no diff view and nobody to email
 * about a wording change during a beta. Bump it when you change the words.
 */
const LAST_UPDATED = "4 September 2026";

/** A heading and its paragraphs. Seven of them; nothing else on the page. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="tw:mt-8">
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

export function PrivacyPage() {
  useDocumentTitle(pageTitle({ kind: "privacy" }));

  return (
    <main className="tw:mx-auto tw:max-w-2xl tw:px-6 tw:pt-[calc(3.5rem_+_var(--safe-top))] tw:pb-24 tw:font-sans">
      <Link
        href="/"
        className="tw:mb-6 tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-ink-faint tw:no-underline tw:hover:text-highlight"
      >
        <ArrowLeft size={13} />
        Back
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
          <Third name="OpenAI" href="https://openai.com/policies/privacy-policy">
            the live voice mode only, and directly rather than through OpenRouter, because nobody
            else routes a realtime connection. Your microphone connects straight from your browser
            to them; the audio never passes through our server. The text of what was said comes back
            to us and is stored as part of the conversation.
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
              is checkable in the code: `zdr: true` is set on dictation and
              nowhere else (src/ai-call.ts § AI_JOB_ROUTE), so a blanket "no
              provider retains anything" claim would be false. Saying which one
              is pinned and linking the rest is the accurate shape.
              docs/project/ai-gateway.md § A key is not access. */}
          We do not sell your text, and we do not train anything on it. Neither do these providers,
          under the terms we use them on — but that is a setting on our account with OpenRouter as
          much as it is a line in our code, so treat it as a commitment we hold ourselves to rather
          than something the page can prove to you. What each provider keeps, and for how long, is
          governed by their own policy, and the links above are the authority on it. Dictation is
          the one call we pin to upstreams that retain none of the content, because it carries your
          voice; the fact that a request happened is still recorded.
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
          <code>gemini-3.1-flash-lite</code> for dictation; and{" "}
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

      {/* The way back out, for a reader who arrived here from the landing page
          and now wants to know what the thing actually does. SiteFooter.tsx. */}
      <SiteFooter />
    </main>
  );
}
