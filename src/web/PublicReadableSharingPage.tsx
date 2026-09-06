/**
 * `/features/public-readable-sharing` — **what we do with an article somebody
 * has made public, written to the person who wrote it.**
 *
 * > Perhaps we should even have a separate page at
 * > `/features/public-readable-sharing` or similar that describes this in more
 * > detail as the single source of truth, and then we can signpost to that from
 * > the tooltips and `/read/public/` and `/privacy` etc.
 * >
 * > — Greg, 2026-09-06
 *
 * ## The two readers, and why that is the hard part
 *
 * Greg chose this address over a top-level `/republishing`, which was argued for
 * on the ground that `/features` sells the product and a rights-holder should
 * not be told their article is a feature of it. That is his call and it stands —
 * but it means **every sentence here has to read correctly to two people at
 * once**: an owner deciding whether to press the switch, and an author who found
 * their own writing on `/read/public` and is not pleased.
 *
 * The way that is resolved throughout is *second person means the author*. The
 * owner is "a reader" or "somebody", never "you". A page that switches which of
 * them it is addressing is a page the second one stops trusting, and the second
 * one is the reader this page exists for.
 *
 * ## Everything on this page has to be true of the code
 *
 * The same live cost PrivacyPage.tsx carries, and for a sharper reason: a
 * rights-holder cannot check any of it, and is relying on us to have. Three of
 * the five things this page was briefed to say turned out to be false or
 * misleading when checked against the code, and the plan records each
 * (docs/plans/260906g-public-readable-sharing-page-and-rights-holder-tooltip.md
 * § Two of the five claims were not true).
 *
 * The two that would have been outright false, kept here because they are the
 * ones somebody will try to add back:
 *
 *  - **"Zero-data-retention models."** `zdr: true` is set on dictation and on
 *    nothing else (`AI_JOB_ROUTE`, src/ai-call.ts), and live conversation does
 *    not go through the gateway at all. What this page claims is the
 *    no-training commitment, carrying the same hedge `/privacy` gives it.
 *  - **"The SEO canonical points search engines at your page."** The canonical
 *    is real (src/public/page-head.ts § `tags`) and no search engine ever reads
 *    it, because every response is `noindex, nofollow` and `robots.txt` is
 *    `Disallow: /`. Saying it the briefed way would have swapped a strong true
 *    claim for a weak one that sounds like an excuse.
 *
 * The four claims that can go stale *silently* — the robots disallow, the
 * `noindex` header, the canonical tag and the no-training wording — are pinned
 * by tests/public-readable-sharing-page.test.tsx, the way tests/privacy-page.test.ts
 * pins model names. A claim about a header is exactly the kind that stays on the
 * page for a year after the header goes.
 *
 * ## The chrome, and the one thing it does not have
 *
 * `SiteNav` and a marketing `SiteFooter`, because the address is under
 * `/features` and a page in that family should look like one. But the body is a
 * prose column at `max-w-2xl`, not the picture-led `SHELL` the other three use:
 * this is a policy read top to bottom, so it borrows PrivacyPage.tsx's `Section`
 * shape rather than SiteBits.tsx's `Showcase`.
 *
 * There is deliberately **no footer link to this page** and no nav entry. It is
 * reached from the two surfaces a stranger meets a republished article on and
 * from `/privacy`, which is where somebody looking for it will be. A fifth entry
 * in the footer row aimed at people with no account would cost every reader a
 * link they will never press.
 *
 * docs/project/public-readable-sharing.md is the doc.
 */
import { ArrowLeft } from "lucide-react";

import { CONTACT_EMAIL } from "../site-text.js";
import { Link } from "./Link.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { PRIVACY_HREF, PUBLIC_LIBRARY_HREF, TAKEDOWN_HREF } from "./router.js";
import { SiteFooter } from "./SiteFooter.js";
import { SiteNav } from "./SiteBits.js";

/**
 * A heading and its paragraphs — PrivacyPage.tsx's `Section`, spelled again
 * rather than exported and shared.
 *
 * **Copied on purpose, and it is four lines.** Lifting it into a shared file
 * would braid a policy page and a marketing-family page together through a
 * component whose whole body is a `max-w`, a font and two colours, so that a
 * change wanted on one arrives unasked on the other. The rule this follows is
 * the one `PublicCard` follows against `ShelfCard` (PublicLibraryPage.tsx § 1):
 * two readers that must not become one. If a third page wants it, that is when
 * it moves.
 */
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

/** The one address we publish, as a link, wherever this page needs it. */
function Mail() {
  return (
    <a
      href={`mailto:${CONTACT_EMAIL}`}
      className="tw:text-highlight tw:no-underline tw:hover:underline"
    >
      {CONTACT_EMAIL}
    </a>
  );
}

export function PublicReadableSharingPage({ signedIn }: { signedIn: boolean }) {
  useDocumentTitle(pageTitle({ kind: "public-sharing" }));

  return (
    <div className="site tw:font-sans tw:text-muted-foreground">
      {/* `here="features"` rather than a value of its own: this page is under
          `/features`, so the bar should drop the Features link the way it does
          on the parent. Adding a fifth member to `SiteNav`'s union would buy a
          distinction nothing draws. */}
      <SiteNav here="features" signedIn={signedIn} />

      <main className="tw:mx-auto tw:max-w-2xl tw:px-6 tw:pt-10 tw:pb-4">
        <Link
          href={PUBLIC_LIBRARY_HREF}
          className="tw:mb-6 tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-ink-faint tw:no-underline tw:hover:text-highlight"
        >
          <ArrowLeft size={13} />
          Shared articles
        </Link>

        <h1 className="tw:m-0 tw:font-prose tw:text-2xl tw:leading-snug tw:text-foreground">
          Public-readable sharing
        </h1>
        <p className="tw:mt-2 tw:mb-0 tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
          What happens when somebody makes an article public here — and what to do if the article is
          yours.
        </p>

        {/* **The offer, before the argument.** Everything below this box is a
            reason to be less unhappy; this is the only thing on the page that is
            an action, and the reader who most needs it is the least likely to
            read to the bottom. PrivacyPage.tsx's summary box, same shape and the
            same reasoning: somebody who reads only this should come away with
            what would actually surprise them. */}
        <p className="tw:mt-5 tw:mb-0 tw:rounded-md tw:border tw:border-rule tw:bg-surface-raised tw:p-4 tw:text-sm tw:leading-relaxed tw:text-foreground">
          <strong className="tw:text-foreground">If a piece here is yours</strong> and you would
          rather it were not, write to <Mail /> and we will take it down. You do not have to prove
          anything first. The rest of this page is what we do and do not do with an article in the
          meantime.
        </p>

        <Section title="What goes out">
          <p>
            When a reader makes an article public, the whole extracted text becomes readable by
            anybody, with no account and nothing to sign up for. It is not an excerpt and there is
            no paywall in front of it. It is also listed on our{" "}
            <Link href={PUBLIC_LIBRARY_HREF} className="tw:text-highlight tw:no-underline tw:hover:underline">
              shelf of shared articles
            </Link>
            , so somebody who was never sent the link can find it.
          </p>
          <p>
            What we keep is the prose, the headings and the figures. The site around them is not
            reproduced — not your navigation, not your design, not anything you sell. The pictures
            in a web article are still loaded from your own servers rather than copied onto ours;
            figures we pulled out of a PDF are the exception, and those we store.
          </p>
          <p>
            What never goes out is the reader's own side of it: their notes, their comments and
            their conversations with the article stay private to them.
          </p>
        </Section>

        <Section title="Your name and your address stay on it">
          <p>
            The title at the top of our copy is itself a link to your page. Directly beneath it we
            print where it came from — your site's address, host and path — as a second, visible
            link. Both open your page in a new tab, and somebody reading without an account sees
            exactly what a signed-in reader sees.
          </p>
          <p>
            Where the article carries an author's name we show that too, above everything else on
            the card and on the page. We do not put our name on your writing.
          </p>
        </Section>

        <Section title="It is kept out of search engines">
          <p>
            This is the part we can be most definite about. Every response Spideryarn serves carries
            an <code className="tw:text-foreground">X-Robots-Tag: noindex, nofollow</code> header,
            every page carries the matching{" "}
            <code className="tw:text-foreground">&lt;meta name="robots"&gt;</code>, and our{" "}
            <code className="tw:text-foreground">robots.txt</code> disallows crawling of the whole
            site. We publish no sitemap. Our deploy script checks the first and the last of those on
            the live site every time we ship, and refuses to finish if either has stopped being
            true.
          </p>
          <p>
            There is one narrow hole and it is worth naming: Facebook's and Twitter's link-preview
            fetchers are allowed at <code className="tw:text-foreground">/read/</code>, so that
            pasting a shared link into a chat shows a title and a one-line description instead of a
            bare URL. Neither of those puts a page into a search result, and both still receive the
            noindex header.
          </p>
          <p>
            Where we recorded the address the article came from, the page also carries a{" "}
            <code className="tw:text-foreground">&lt;link rel="canonical"&gt;</code> pointing at
            yours, so any machine that does read our copy is told yours is the authoritative one.
            That is belt-and-braces rather than the main protection: nothing is indexing us to begin
            with.
          </p>
        </Section>

        <Section title="Nothing becomes public by accident">
          <p>
            Everything anybody adds to Spideryarn is private to them by default. To share one, a
            reader has to open a dialog headed <em>“Share the full text of this article?”</em>, read
            a list of exactly what a shared link carries, and tick a box that says{" "}
            <em>“I have the right to share this article's text.”</em> Our server refuses the request
            without that tick, and we keep a record of who made it and when.
          </p>
          <p>
            But we should be straight about what that is worth:{" "}
            <strong className="tw:text-foreground">
              it is a promise they make, not a check we run
            </strong>
            . Nobody at Spideryarn reads an article before it appears on the shelf, and we have no
            way of knowing who owns a page we fetched. That is exactly why the offer at the top of
            this page exists, and why we take a fair complaint at face value.
          </p>
        </Section>

        <Section title="What the AI adds, and whose it is">
          <p>
            Spideryarn writes summaries at several levels of detail, a one-line gist, a glossary, a
            timeline and diagrams. Those are written by a language model reading your text. They are
            not quotations, they are not your words, and where one of them is wrong about your
            argument, that is our mistake and not yours.
          </p>
          <p>
            Today nothing printed beside them says so, which we think is a gap and intend to close.
            What we never do is quietly rewrite your prose: at the finest level of zoom the reader
            is always looking at the paragraph you actually wrote.
          </p>
        </Section>

        <Section title="Money, and what we get out of this">
          <p>
            Readers pay us for the tool. Somebody reading a public article pays nothing, sees no
            advertising, and is not tracked across the web. We do not sell anybody's text, and
            nobody trains a model on it — though, as our{" "}
            <Link href={PRIVACY_HREF} className="tw:text-highlight tw:no-underline tw:hover:underline">
              privacy policy
            </Link>{" "}
            says of the same promise, that rests partly on a setting on our account with our AI
            provider, so treat it as a commitment we hold ourselves to rather than something this
            page can prove to you.
          </p>
          <p>
            Two things you would otherwise have to find out for yourself. Public articles are where
            we draw the examples shown on our home and features pages, so a shared piece may appear
            there as a link. And making an article public halves what it counts against a reader's
            monthly allowance, so there is a small incentive in the direction of sharing.
          </p>
        </Section>

        <Section title="If something here is yours">
          <p>
            Write to <Mail />. It helps to include the address of the Spideryarn page it is on,
            where the piece was originally published, and a line about your connection to it — the
            first of those most of all, because a message that does not name one is hard to act on.
          </p>
          <p>
            One person reads that mailbox and does this by hand, so expect days rather than hours.
            What <em>taken down</em> means exactly — what happens to the shared link, and what
            happens to the copy the reader who added it still has — is set out on the privacy page,
            under{" "}
            <Link href={TAKEDOWN_HREF} className="tw:text-highlight tw:no-underline tw:hover:underline">
              If something here is yours
            </Link>
            .
          </p>
        </Section>

        {/* **Last, and hedged, because it is the one paragraph that could
            insult the reader it is aimed at.** Greg's brief asked the page to
            say we hope this increases readership and appreciation of the work.
            Said plainly it reads as a company explaining why taking your writing
            is good for you, so the claim it makes is about *our tool* — that a
            reader ends up in the paragraphs rather than skimming past them —
            rather than about the author's benefit, and it concedes the point in
            its last sentence rather than leaving the reader to make it. */}
        <Section title="Why this exists at all">
          <p>
            We built Spideryarn because good writing deserves better than being skimmed, or fed to a
            chatbot and replaced with four bullet points. The summaries here exist to get somebody
            into your paragraphs — to help them find their way around a long piece and then read it
            properly — rather than to save them the trouble of reading it. Our hope is that a person
            comes out of one of these having actually understood what you wrote.
          </p>
          <p>
            That is our hope rather than your obligation, and it changes nothing about the answer
            above: if you would rather your work were not here, say so and it goes.
          </p>
        </Section>
      </main>

      <div className="tw:mx-auto tw:max-w-2xl tw:px-6">
        <SiteFooter variant="marketing" />
      </div>
    </div>
  );
}
