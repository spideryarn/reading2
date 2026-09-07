/**
 * The article-level chrome: what the piece is, before you start reading it.
 *
 * Greg, 2026-08-25:
 *
 * > Let's add the title etc (along with any other metadata we have and useful
 * > related UI) to the top masthead row, perhaps with a down-arrow to expand
 * > that to show more information.
 *
 * This is where the *constant* facts about the article live, and that word is
 * doing the work. The reading view's horizontal axis means granularity and its
 * vertical axis means position, so anything that varies along neither belongs
 * in chrome rather than in a column — which is exactly what the old L0 column
 * got wrong (tree.js § the arc). Title, byline, source, counts: all constant,
 * all here.
 *
 * What is here is only the half you want *before* deciding to read: title, who
 * wrote it and where, and the one-sentence gist of the whole piece.
 *
 * The other half — provenance and shape, the source link, the counts, which
 * model built the tree — used to be here too, behind a `▾`. It moved to the
 * bottom drawer on 2026-08-25 (Dock.tsx), and the reason is the paragraph
 * below: **this element scrolls away.** Its disclosure was therefore only
 * reachable from the very top of the article, and opening it pushed the whole
 * table down. The facts you want when something looks wrong are exactly the
 * facts you want *without* going back to the top first.
 *
 * It moved once more the same day, out of the drawer and onto a page of its
 * own — Metadata.tsx, `/read/<slug>/metadata`, reached from the bar's Metadata
 * button (docs/plans/260825e-metadata-page.md). So there are two superseded spellings
 * of it in old links, `?about=1` and `?panel=about`, and main.tsx rewrites both
 * to the page.
 *
 * Whether this masthead should link there was open until 2026-09-04, when half
 * of it was answered: `SharingMark` below is a link to that page, because the
 * fact it draws — who can read this — is changed there and nowhere else. The
 * other half is still open. A reader who wants the *rest* of what the metadata
 * page holds has to find the bottom bar.
 *
 * Since 2026-08-27 the title here is **editable**: a pencil beside it opens the
 * same in-place editor the shelf has, because the page you are reading is the
 * place you notice the title is wrong. The editor, the request and the three
 * outcomes a rename has are all in TitleEditor.tsx — this file only says where
 * the heading is and what it looks like. docs/project/library.md § The pencil
 * is on three pages now.
 *
 * Note the masthead scrolls away by design (it is `position: sticky` only on
 * the horizontal axis, so it stays put when the table scrolls sideways). What
 * stays with you as you read is the spine and the arc column, not this.
 */
import { useMemo, type ReactNode } from "react";
import { ArrowLeft, ExternalLink, FileQuestion, Globe, Lock, Upload } from "lucide-react";
import {
  SHARING_BADGE,
  SHARING_MARK_HOW_PRIVATE,
  SHARING_MARK_HOW_PUBLIC,
  SHARING_MARK_NAME_PRIVATE,
  SHARING_MARK_NAME_PUBLIC,
  SHARING_MARK_PRIVATE,
  SHARING_MARK_PUBLIC,
} from "../messages.js";
import type { Article, Meta, Visibility } from "../types.js";
/* The shared one, which drops a leading `www.` — three copies of this used to
   live in the client and its header asks the next caller not to make a fourth.
   `isWebUrl` is not imported here any more: the one URL sink in this file is the
   heading anchor, and `webSource` below already refuses everything that is not
   `http(s)` — one test rather than two spellings of it. */
import { hostOf } from "../urls.js";
import { Link } from "./Link.js";
import { SourceLink, webSource } from "./SourceLink.js";
import { carriedSearch, LIBRARY_HREF, readHref } from "./router.js";
import { articleStats } from "./stats.js";
import { ControlTip, Tooltip } from "./Tooltip.js";
import { EditableTitle, useArticleRename } from "./TitleEditor.js";

interface Props {
  article: Article;
  /**
   * **The address, not `meta.slug`.**
   *
   * They are usually the same and once in a while they are not, which is the
   * whole reason this prop exists: an address with no article of its own was
   * answered with the committed fixture until 2026-08-30, so `/read/anything`
   * hands this component a `meta.slug` of `noema-mythology-of-conscious-ai`
   * (example/meta.json). Renaming through that would
   * have PATCHed the real Noema article's shelf row while appearing to rename
   * the thing on screen. GPT Sol, 2026-08-27.
   *
   * The route slug is also what `loadShelf` used to pick the title being drawn
   * here in the first place, so it is the only slug this heading is about.
   */
  slug: string;
  /**
   * The article has been renamed — take this title.
   *
   * Owned by `OwnedArticle` in App.tsx, which holds the payload this masthead
   * is drawing, so one write updates the heading, the tab and every other view
   * of the same article at once. A masthead that kept the new title to itself
   * would disagree with the metadata page one click away.
   *
   * **Absent for a visitor reading a shared document**, and its absence is what
   * hides the pencil. A rename is a PATCH against a shelf row a visitor does
   * not have, so the button could only ever fail, and a button that can only
   * fail is worse than no button because pressing it is how you find out —
   * the same rule Delete follows on the metadata page. 2026-08-28.
   */
  onRenamed?: ((slug: string, title: string) => void) | undefined;
}

export function Masthead({ article, slug, onRenamed }: Props) {
  const { meta, tree } = article;
  /* The same rename the shelf offers, from the page you are actually reading —
     Greg, 2026-08-27. See TitleEditor.tsx for why the request lives in a hook
     rather than here, and why this site cannot say whether the title on screen
     is the reader's own.

     **Mounted only for an owner, since 2026-08-28.** It used to be called
     unconditionally with a no-op and `offer={false}` under it — which worked,
     and was a convention rather than a seam: the hook holding an authenticated
     `PATCH` was one careless `offer` away from being reachable by somebody who
     could not use it. GPT Sol asked for the boundary and it costs one
     component. reader-capability.ts says why a boolean cannot do this job. */
  // The counts live in stats.ts now, because the drawer's About panel needs the
  // same arithmetic and two copies of it would drift.
  const stats = useMemo(() => articleStats(article), [article]);
  const root = tree.nodes[tree.rootId];

  /**
   * Where this article came from — `null` when there is no web address for it.
   *
   * `webSource` rather than `meta.url`, and it does two jobs at once.
   *
   * A `file://` from the local PDF command is not drawn as a link that goes
   * nowhere and prints somebody's home directory on the way. SourceLink.tsx owns
   * the question.
   *
   * **And it is the allowlist on a URL sink**, which is not decoration.
   * `meta.url` is the revision's `final_url`, which the fetcher validates — but
   * an *imported* article's metadata is written straight into the row, so a
   * `javascript:` or `data:` value is reachable here and this anchor would be an
   * active sink. `webSource` refuses those the same way `isWebUrl` does
   * (src/urls.ts, docs/project/security.md). GPT Sol found it while reviewing
   * the plan that added a second link to the same field, 2026-08-31.
   */
  const source = webSource(meta);

  /**
   * The heading, and the one mark beside it saying who can read the piece.
   *
   * A fragment rather than a lone `<h1>` because both wrappers below lay their
   * children out in a flex row — `EditableTitle`'s is the row the pencil sits
   * in — so the mark lands beside the title without either of them being told
   * about it. Outside the `<h1>` on purpose: `h1 a` in styles.css underlines on
   * hover, which on an icon-only link is a stray dash under a glyph.
   *
   * **A second mark stood here until 2026-09-06** — `OriginMark`, an ↗ or a ⬆
   * saying where the piece came from. It is `OriginLine` below now, under the
   * title and in words, because a glyph is not what Greg asked this feature for
   * either time he asked for it: see that component's header.
   */
  const heading = (
    <>
      <h1 className="tw:min-w-0 tw:flex-1">
        {source ? (
          <a href={source} target="_blank" rel="noreferrer noopener">
            {meta.title}
          </a>
        ) : (
          meta.title
        )}
      </h1>
      {/* **Owner-only, twice over.** `article.visibility` is on the owner's
          payload and on no other, so a visitor's article has nothing to draw
          from — and the gate is written out anyway, on the same
          `onRenamed !== undefined` stand-in for *is this yours* that
          `OriginLine` below uses. Two guards for one fact because the cost of
          the second is a term and the cost of being wrong is the owner's
          sentence about their own library shown to a stranger, over a link to
          a page that stranger cannot open. */}
      <SharingMark
        slug={slug}
        visibility={onRenamed === undefined ? undefined : article.visibility}
      />
    </>
  );

  // Only the parts of the facts line this article actually has. Joining a
  // filtered list beats a chain of `&&`s that can leave a stranded separator.
  const facts = [
    meta.byline,
    meta.siteName,
    `${stats.words.toLocaleString()} words`,
    `~${stats.minutes} min`,
    `${stats.parts} parts`,
    `${stats.sections} sections`,
  ].filter(Boolean) as string[];

  return (
    <div className="masthead">
      <div className="masthead-inner">
        {/* The way back to the shelf. Here rather than in the sticky controls
            bar because it belongs with the article's identity, not with the
            granularity controls — and because the bar is measured by
            `stickyOffset()`, so anything added to it changes where every deep
            link and arrow jump lands (scroll.ts). Browser Back does the same
            job; this is for the reader who arrived by pasted link and has no
            Back to press. The bottom bar had a Home button too until
            2026-08-26; the way home is the wordmark fixed in the top-left
            corner of the window now (HomeLogo.tsx), and this is still not a
            duplicate of it for the reason it was not a duplicate of the
            button: this one is named after where it goes and scrolls away with
            the title, and that one is a brand mark that is always there.
            Utilities rather than a rule in styles.css: chrome is what Tailwind
            is here for (web-client.md#tailwind-and-shadcn-components). */}
        <Link
          href={LIBRARY_HREF}
          className="tw:mb-1.5 tw:inline-flex tw:items-center tw:gap-1 tw:font-sans tw:text-xs tw:text-ink-faint tw:no-underline tw:hover:text-highlight"
        >
          <ArrowLeft size={13} />
          Library
        </Link>
        {/* The title, and the pencil beside it — TitleEditor.tsx owns where the
            pencil hides, what replaces the heading, and what a failed write
            says, because the metadata page needs all three the same way. */}
        {onRenamed ? (
          <RenameableTitle slug={slug} meta={meta} onRenamed={onRenamed}>
            {heading}
          </RenameableTitle>
        ) : (
          /* A visitor's title, with no rename hook mounted anywhere near it. */
          <div className="tw:flex tw:min-w-0 tw:items-baseline tw:gap-2">{heading}</div>
        )}

        {/* **Where the piece came from, directly under the title** — the
            address itself when there is one, and words when there is not. See
            `OriginLine`.

            Above the facts line rather than inside it: the byline and the
            counts are things about the article, and this is the one line that
            says the article is a copy of something that exists elsewhere.

            **`onRenamed !== undefined` is what makes the second argument
            honest**, and it is not a decoration — this masthead cannot
            otherwise tell "uploaded, so there is no address" from "a visitor,
            so we did not send them one". Same stand-in for *is this yours* that
            `SeeTheOriginal` below and `SharingMark` above use, asked once.

            **`meta.source` is the evidence; the absent URL is only the
            occasion.** An owner can hold a *web* article with no URL (a lost
            `meta.json`, a revision published with neither address), and calling
            that an upload is a false sentence about their library. */}
        <OriginLine
          source={source}
          origin={onRenamed === undefined ? null : meta.source === "pdf" ? "upload" : "unrecorded"}
        />

        <p className="facts">
          {facts.map((f, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static line, rebuilt whole, no child state
            <span key={i}>{f}</span>
          ))}
        </p>

        {/* **Where this article came from, when the answer is not "a web page".**
            A PDF was read by a model, and the reader is entitled to know that
            before they trust a sentence in it.

            Two states, and the difference between them is the whole point. A
            born-digital PDF has its own text layer, so every page was checked
            against it and the number says how well — that is a fact, and it is
            stated quietly. A scan has no text layer at all, so nothing checked
            anything, and saying so needs a sentence rather than a badge: a
            reader who sees a word like "unverified" and no explanation will
            either ignore it or over-read it.

            The link is the part that matters most. A second machine's opinion
            would not be verification; a person looking at the ink is. So the
            original is one click away. docs/plans/260826c-pdf-ingestion.md § A scan
            with no text layer. */}
        {meta.source === "pdf" && (
          <p className="source-note">
            {meta.unverified ? (
              <>
                Transcribed by a machine from a scanned image. There was no text in the file to
                check it against, so nothing has verified it.{" "}
                <SeeTheOriginal slug={meta.slug} offer={onRenamed !== undefined}>
                  View the scanned pages
                </SeeTheOriginal>
              </>
            ) : (
              <>
                Transcribed by a machine from a PDF, and checked against the file's own text on{" "}
                {meta.pagesChecked ?? 0} of {meta.pages ?? 0} pages.{" "}
                <SeeTheOriginal slug={meta.slug} offer={onRenamed !== undefined}>
                  View the original
                </SeeTheOriginal>
              </>
            )}
          </p>
        )}

        {/* The whole piece in one sentence — the coarsest thing there is, and
            constant, so it belongs here rather than in a column. */}
        {root?.gist && <p className="root-gist">{root.gist}</p>}
      </div>
    </div>
  );
}

/**
 * **Where the article came from, said in words under the title — the address
 * itself when there is one.**
 *
 * Greg, 2026-08-30, on opening a piece he had uploaded and looking for the link
 * back to where he got it:
 *
 * > Ah, maybe I'm being dense - I forgot that I uploaded it, so that would
 * > explain why it doesn't have the original url where I got the article from!
 * > In that case, make it clear that it was uploaded!
 *
 * The title has linked to `meta.url` since the masthead existed, and that is
 * the whole problem: a link that looks exactly like a heading tells you nothing
 * when it is *absent*. An article with no web address was silently
 * indistinguishable from one whose title you had simply never thought to click.
 * So both states get a line, and both of them get words.
 *
 * ## Why this is a line and not the ↗ glyph it was
 *
 * It was a 28px icon beside the title from 2026-08-30 until 2026-09-06 —
 * `OriginMark`, an ↗ out to the publisher or a ⬆ meaning uploaded, with the
 * sentence in a `title` attribute. Greg, 2026-09-06:
 *
 * > Show the url from which the original came (if there is one) right
 * > underneath the title in the masthead. I know we have the view-the-original
 * > button, but I think it's important that we are prominent about the origin.
 *
 * Both of his instructions on this feature ask for the same thing and the glyph
 * answered neither. *"Make it clear that it was uploaded"* was answered with a
 * shape whose meaning is only in a tooltip; *"prominent about the origin"* is
 * not something a 14px arrow can be. A reader who wants to know whose page this
 * is — the question that decides how much of it to believe — should not have to
 * hover anything to find out.
 *
 * So the glyph went rather than gaining a third sibling. The URL case would
 * otherwise have had three affordances for one address within two lines: the
 * title, the mark, and the line. The title stays a link because it always has
 * been and costs nothing; this is the one that *says* where you are going.
 *
 * The address is drawn host-first with the path faded after it, because the
 * host is the part that answers the question and the path is the part that
 * runs off the end of a narrow window. Truncation is the path's, in CSS, so
 * the host is never the thing that gets cut (styles.css § `.origin`).
 *
 * ## The link is for everybody; the *word* "uploaded" is not
 *
 * Greg, 2026-08-30: *"I think Public-readable articles should show their
 * provenance-url to all reader[s]."* So a visitor gets `meta.url` too, since
 * that day — `PublicMeta.url`, which is `articles.final_url` put through
 * `publicSourceUrl` (src/urls.ts) — and the first branch below needs no gate.
 *
 * The second branch still does, and it is worth being exact about why, because
 * the reason narrowed rather than went away. For a visitor an absent
 * `PublicMeta.url` means *either* an upload *or* an address `publicSourceUrl`
 * withheld — a credential in it, a private host, a query it could not vouch for
 * — and the two are indistinguishable from here. Ungated, an article whose URL
 * happened to carry a password would tell every stranger it was uploaded.
 *
 * Before that day the hole was wider: no visitor received a `url` at all, so
 * *every* shared web article would have said it. The gate that fixed the wide
 * version is the same one that fixes the narrow version, which is the argument
 * for having written it against the reason rather than against the symptom.
 *
 * A visitor in that case gets no line at all rather than a wrong one. The
 * alternative — a third "we cannot say" state — would be chrome explaining our
 * projection layer to somebody reading an essay.
 *
 * ## And "owner + no URL" is still not "uploaded"
 *
 * That was the first version's inference and it is false, which GPT Sol found by
 * reading the two paths that produce an owner's `Meta` rather than the one that
 * produces most of them. A missing `meta.json` is **explicitly tolerated**,
 * and a revision may be published with no URL at all —
 * `requested_url` and `final_url` are both nullable (src/db/schema.ts), which is
 * what `src/store/import.ts` relied on before it was deleted on 2026-09-01 and
 * what publication relies on still. Either gives an owner a perfectly ordinary web
 * article with no address, and the line would have told them they had uploaded
 * it — a claim about something they did, made out of a gap in our own files.
 *
 * So the evidence is `meta.source === "pdf"`, which is a fact stage 2 wrote
 * down, and the absent URL is only the occasion for looking. Everything else
 * gets "No web address was recorded", which is a statement about our records
 * and is true in every one of those cases.
 *
 * The PDF sentence further down (`SeeTheOriginal`) is the other half of this
 * and is not duplicated by it: that one is about *trusting the transcription*
 * and links to the file itself; this one is about *where the piece is from*.
 * An uploaded PDF shows both, and they say different things.
 */
function OriginLine({
  source,
  origin,
}: {
  source: string | null;
  /**
   * What to say when there is no address — or `null` for *say nothing*.
   *
   * `null` is a visitor, for the reason in the header. `"upload"` is a PDF, and
   * is the only case with an actual explanation. `"unrecorded"` is an owner's
   * article that is *not* a PDF and still has no address, which is a real state
   * — a missing `meta.json` is tolerated on purpose, and a revision may
   * be published with neither `requested_url` nor `final_url`
   * (src/db/schema.ts). It gets its own words rather than borrowing the upload's,
   * because "you uploaded this" is a claim about what the reader did.
   */
  origin: "upload" | "unrecorded" | null;
}) {
  if (source) {
    /* `null` when the address will not parse — see `addressParts`, which is
       also the reason the raw string is never printed. */
    const parts = addressParts(source);
    /* **The link's *name*, which is deliberately not what it says.** The visible
       text is an address, and an address read aloud is a string of syllables
       that does not announce it goes anywhere. The tooltip is the `describedby`
       (Tooltip.tsx § `useRole`) and this is the name, kept shorter than it —
       the same split `SharingMark` makes below, and for the same reason. */
    const label = parts ? `View the original at ${parts.host}` : "View the original";
    return (
      <p className="origin">
        <Tooltip
          placement="bottom"
          /* A single trigger with plenty of room, but it sits hard against the
             left edge of the window on a narrow screen, which is the case
             `keepSide` exists for — Tooltip.tsx says why the default `flip`
             throws a too-wide card onto the cross axis. */
          keepSide
          className="tip-soon"
          content={
            <ControlTip
              head={parts?.host ?? "The original"}
              what="The page this article was made from. What you are reading is our copy of its prose, its headings and its figures — the site around them is not here."
              how="Opens the publisher's page in a new tab. It was read once, when the article was added, so what is there now may have changed, moved or gone behind a paywall."
            />
          }
        >
          <a
            href={source}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={label}
            className="origin-link"
          >
            <ExternalLink size={13} strokeWidth={1.75} className="origin-icon" />
            {/* The words rather than the address when there is no address a
                reader could read — `addressParts` says why the malformed value
                itself does not go on the page. */}
            <span className="origin-host">{parts ? parts.host : "View the original"}</span>
            {parts && <span className="origin-path">{parts.rest}</span>}
          </a>
        </Tooltip>
      </p>
    );
  }

  if (origin === null) return null;

  /* **Both `how`s say the thing the visible words cannot**, which is
     `ControlTip`'s rule and the one an earlier draft broke twice: the upload's
     restated *there is nowhere to go back to*, and the unrecorded one promised
     that re-adding the piece from its URL would fill the field in — which is
     not true of an existing row, since deduplication has nothing to match it
     against and would adopt or create a different article. GPT Sol, 2026-09-06. */
  const said =
    origin === "upload"
      ? {
          icon: <Upload size={13} strokeWidth={1.75} className="origin-icon" />,
          text: "Uploaded from a file",
          head: "Uploaded",
          what: "This one arrived as a file rather than a web address, so there is no publisher's page to go back to.",
          how: "The file itself is still here — for a PDF, the note below this line is the way to open it. What is missing is only the page it came from.",
        }
      : {
          icon: <FileQuestion size={13} strokeWidth={1.75} className="origin-icon" />,
          text: "No web address was recorded",
          head: "No web address",
          what: "We have no record of where this article came from — which is a statement about our files rather than about the article.",
          how: "It does not mean you uploaded it: we would say so if you had. It means the address was never written down, or was lost between one revision and the next.",
        };

  /* **Not a control, and two shapes were rejected for it.** `tabIndex` on a
     plain element is what biome refuses (`a11y/noNoninteractiveTabindex`), and
     a `<button>` promises that Enter does something, which this does not. So it
     is a `<span>` with `cursor-help`, and what it gains instead is the
     `sr-only` sentences below — the same three-way decision `AccessSharing`'s
     inventory chips made, and for the same reasons.

     **What that costs, stated rather than glossed over:** a sighted keyboard
     user cannot open this card, because there is nothing here to focus. GPT
     Sol, 2026-09-06. The state itself is visible text, so what they miss is the
     two sentences of context and not the fact — which is why this is the state
     the whole redesign moved *out* of a tooltip. If a third of these ever needs
     the card badly enough, the answer is a focusable trigger with a
     focus-visible ring, not a `title`. */
  return (
    <p className="origin">
      <Tooltip
        placement="bottom"
        keepSide
        className="tip-soon"
        content={<ControlTip head={said.head} what={said.what} how={said.how} />}
      >
        <span className="origin-said">
          {said.icon}
          {said.text}
          {/* **Both sentences, permanently in the accessibility tree.**
              `useRole` gives the panel an `aria-describedby` only while it is
              *open*, and a screen-reader user moving by virtual cursor never
              opens it — so the explanation would otherwise be announced to
              nobody. It carries the `how` as well as the `what`, because the
              `how` is the half that is not already visible above it. */}
          <span className="tw:sr-only">
            {" — "}
            {said.what} {said.how}
          </span>
        </span>
      </Tooltip>
    </p>
  );
}

/**
 * **The address in two pieces — the half that answers the question, and the
 * half that may be cut** — or `null` when it will not parse.
 *
 * Not in src/urls.ts, which is where every *decision* about a URL lives. This is
 * a decision about type: it exists so the host can be the part that survives a
 * narrow window, and it has one caller.
 *
 * ## Three things it gets right that the first version did not
 *
 * **The trailing slash is stripped from the path and from nothing else.** It was
 * stripped from the whole concatenation, so `example.com/a?next=/` displayed as
 * `example.com/a?next=` — a *different query* from the one the link carries,
 * which is the one thing a line about provenance may not do. Same for a fragment
 * ending in a slash. GPT Sol, 2026-09-06.
 *
 * **A non-default port survives, in the second half.** `hostOf` reports
 * `URL.hostname`, which drops it, so `example.com:8443/p` would have been drawn
 * as `example.com/p` — again a different address from the `href`. It rides with
 * the path rather than with the host because that is where `hostOf`'s cut falls,
 * and one spelling of the `www.` rule is worth more than the port's position in
 * the line. `URL.port` is `""` for a scheme's default, so the common case adds
 * nothing.
 *
 * **`null` rather than the raw string when it will not parse.** `webSource`'s
 * allowlist is a `/^https?:\/\//` regex, not a parse, so `http://[bad` reaches
 * here — and the first version printed it, which made this line a visible-text
 * sink for a malformed value an *imported* article's metadata can carry
 * (src/web/SourceLink.tsx § `webSource`). React escapes it, so it was never
 * markup; it could still be a screenful of bidi controls under the title. The
 * link stays, because a `javascript:` value cannot get this far and the reader
 * is entitled to the way out — only the *printing* goes.
 */
function addressParts(url: string): { host: string; rest: string } | null {
  /* The shared one, so this is not the fourth copy of the `www.` rule the
     header of src/urls.ts asks nobody to write. It returns `""` for anything
     `new URL` refuses, which for an `http(s)` string is the only way its
     hostname can be empty — so this is also the parse check. */
  const host = hostOf(url);
  if (!host) return null;
  try {
    const u = new URL(url);
    const port = u.port ? `:${u.port}` : "";
    return { host, rest: `${port}${u.pathname.replace(/\/$/, "")}${u.search}${u.hash}` };
  } catch {
    /* Unreachable — `hostOf` has already parsed it. Here rather than a `!`
       because a throw in render takes the whole reading view down through
       AppBoundary.tsx. */
    return null;
  }
}

/**
 * **Who can read this, at the top of the page you read it on** — and the way to
 * change it.
 *
 * Greg, 2026-09-04:
 *
 * > Make it a bit clearer at the top of an article page with an icon if it's
 * > public or not - actually, make that a clickable button with clear tooltip
 * > that takes you to the profile to change whether the article is
 * > private/public
 *
 * "The profile" is this article's **Metadata** page: `AccessSharing` is the
 * only control in the app that changes an article's visibility, and it lives in
 * that page's *Access & sharing* section — the third of eight, because Greg
 * asked for it to be moved up (Metadata.tsx).
 *
 * **The link stops at the page and does not aim at the section**, which was the
 * first design and is the one thing here that was cut rather than forgotten.
 * Aiming needs a place in the address for "which section", and this app took
 * the fragment out on purpose: docs/project/url-state.md § Why the query string
 * and not the hash — one query string, one listener. Adding either a `#` or a
 * `?focus=` back is a new piece of URL state, a row in that doc's table and a
 * scroll that has to wait for a page that renders after its own fetch, to save
 * a reader half a screen of scrolling on arrival. Worth doing if the landing
 * turns out to feel wrong; not worth doing first.
 *
 * ## Absence is the third state, and it draws nothing
 *
 * `undefined` means *nobody could tell us*, never *private*. It is a visitor's
 * payload, which carries no `visibility` at all, and it was also the filesystem
 * store, which had no visibility column — that store went on 2026-09-05
 * (docs/project/database.md) and the field is still optional, so the state is
 * still reachable and still has to draw nothing. Silent is the only honest
 * thing it can be: a lock is a claim, and a lock drawn over a source that was
 * never asked would tell an owner that only they can read an article nobody
 * enquired about. That is the one sentence this control must never get wrong,
 * which is the rule `AccessSharing` was rebuilt around and the class in
 * docs/reusable/silent-success.md.
 *
 * ## Why a `Tooltip` rather than a `title`, and why a `ControlTip` inside it
 *
 * Because Greg asked for a clear one, and a `title` attribute is not: it waits
 * about a second, it is a system font in a system box, and it opens on hover
 * only — so a reader who tabs onto the link never sees it. The `Tooltip` fixes
 * all three, and `useFocus` is the half that matters most.
 *
 * The card inside it was a **bare string** until 2026-09-06, which had two
 * costs. `.tooltip` sets no font-size on purpose, so unclassed content inherits
 * `body`'s 1rem and this one panel came out visibly larger than every other
 * tooltip in the app (Tooltip.tsx § `TipNote`). And a sentence with no head has
 * nowhere to put the state: *Shared* or *Private* is the word the reader came
 * for, and it was the fourth word of a paragraph. `ControlTip`'s shape — the
 * state, what it means, then the thing you cannot work out by pressing — is
 * what this control wanted all along.
 *
 * **It does not fix touch, and an earlier version of this comment claimed it
 * did.** On a touch device the tap that would open the tooltip is the tap that
 * follows the link, so neither spelling of hover help is reachable there — the
 * `aria-label` and the destination are what a touch reader actually gets. GPT
 * Sol, 2026-09-04. Real touch help would need a deliberate reveal or visible
 * text, and neither is worth a second control beside the title.
 *
 * `Link`, not `IconButton`: this navigates, so it has to be an `<a>` with a
 * real `href` — command-click opens the metadata page in a tab, and the status
 * bar says where it goes. `IconButton` is a `<button>` with an `onClick`.
 */
function SharingMark({
  slug,
  visibility,
}: {
  slug: string;
  /** `undefined` means the store could not say — see the header. */
  visibility: Visibility | undefined;
}) {
  if (visibility === undefined) return null;

  const shared = visibility === "public";
  /* Two strings, and they are deliberately not one — see `SHARING_MARK_NAME_PUBLIC`
     in src/messages.ts. The tooltip becomes `aria-describedby`, so a name
     holding the same sentence is announced twice. */
  const tip = shared ? SHARING_MARK_PUBLIC : SHARING_MARK_PRIVATE;
  const name = shared ? SHARING_MARK_NAME_PUBLIC : SHARING_MARK_NAME_PRIVATE;
  /* The state as a word, which is what a reader hovering this actually came for
     — `SHARING_BADGE` because the shelf already calls it that, and an owner who
     has met *Shared* on a card should not meet a synonym here. */
  const head = shared ? SHARING_BADGE : "Private";
  /* The half a reader cannot work out by pressing — `ControlTip`'s rule. Both
     are about what *stopping* or *starting* does not do. */
  const how = shared ? SHARING_MARK_HOW_PUBLIC : SHARING_MARK_HOW_PRIVATE;

  /* The view state carried across, so stepping out to the switch and coming
     back returns the reader to the paragraph they left — the same
     `carriedSearch(location.search)` the dock's Metadata button uses, read at
     render for the reason Dock.tsx sets out: nuqs writes the URL itself, so
     `location.search` is always current, and this masthead re-renders with the
     page that is subscribed to every parameter in it. */
  const href = readHref(slug, carriedSearch(location.search), "metadata");

  return (
    <Tooltip
      content={<ControlTip head={head} what={tip} how={how} />}
      placement="bottom"
      keepSide
      className="tip-soon"
    >
      <Link
        href={href}
        /* The tooltip is the sentence a sighted reader gets; `aria-label` is
           the *name*, which is a shorter and different thing. No `title`
           beside them — that would be a second tooltip saying the same thing a
           beat later. The same rule IconButton.tsx states, with the hover half
           moved to a component that can style it, and the name kept distinct
           from the description. */
        aria-label={name}
        /* The pencil's 28px square and `mt-1`, so title, mark and pencil sit on
           one line at any title length — IconButton.tsx says why a stated size
           rather than padding round a glyph. Not `IconButton` itself: that is a
           `<button>` with an `onClick`, and this is a link. (`OriginMark` used
           to sit beside it in the same box; it is `OriginLine` above now, and
           this is the only mark left in the row.) `text-highlight` when it is
           out in the world, matching the shelf's own `SharedBadge`
           (ShelfEntry.tsx) — one article, one colour, whichever page you meet
           it on. */
        className={`tw:mt-1 tw:inline-flex tw:size-7 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-md tw:no-underline tw:transition-colors tw:hover:bg-highlight/10 tw:hover:text-foreground ${
          shared ? "tw:text-highlight" : "tw:text-ink-faint"
        }`}
      >
        {shared ? <Globe size={14} strokeWidth={1.75} /> : <Lock size={14} strokeWidth={1.75} />}
      </Link>
    </Tooltip>
  );
}

/**
 * **The way to the original file — offered only to the reader who may have it.**
 *
 * `SourceLink` fetches `GET /api/source/:slug`, which is authenticated, and
 * stage 1 deliberately does not serve it publicly: *"Serving somebody's
 * uploaded bytes to the world is a separate decision from serving the extracted
 * text. Hide the link rather than 404 it."*
 * docs/plans/260827ai-public-read-only-access.md § What a public visitor gets.
 *
 * That decision was written down and then not built. Every visitor to a shared
 * **PDF** mounted the control, so pressing it — or tabbing to it and pressing
 * Enter, which is the half that is easy to forget — opened a blank tab, issued
 * a private request, was refused, and left the reader looking at nothing. GPT
 * Sol, second pass, 2026-08-28.
 *
 * **The sentence stays and only the control goes.** A visitor is entitled to
 * know the article was transcribed from a scan and how much of it was checked
 * — that is a fact about how much to trust what they are reading, and the whole
 * reason the note exists (docs/plans/260826c-pdf-ingestion.md § A scan with no text
 * layer). What they cannot have is somebody else's uploaded file.
 *
 * `offer` keyed on `onRenamed`, which is this component's existing stand-in for
 * *is this yours* — see the prop's own comment. One question, asked once.
 */
function SeeTheOriginal({
  slug,
  offer,
  children,
}: {
  slug: string;
  offer: boolean;
  children: ReactNode;
}) {
  /* Not a disabled control and not a marked one: there is nothing here a
     visitor could ever be given, so a dimmed button would be advertising a
     door that does not exist. The bands mark what an account would unlock;
     this is not that. */
  if (!offer) return null;
  return (
    <>
      <SourceLink slug={slug}>{children}</SourceLink>.
    </>
  );
}

/**
 * **The title, with the pencil — and the hook behind it, mounted only here.**
 *
 * `useArticleRename` holds an authenticated `PATCH /api/library/:slug`. It used
 * to be called unconditionally in `Masthead`, with a no-op callback and
 * `offer={false}` under it. That worked, and GPT Sol was right to call it a
 * convention rather than a seam: nothing structural stopped the trigger being
 * reachable, only a boolean somebody could flip while thinking about something
 * else.
 *
 * A hook cannot be skipped conditionally, so the condition is this component
 * existing — the same construction `OwnedReader` uses for comments, chat and
 * the glossary read, and `WithLinkFacts` for the hover lookups.
 * reader-capability.ts.
 *
 * TitleEditor.tsx owns where the pencil hides, what replaces the heading, and
 * what a failed write says, because the metadata page needs all three the same
 * way.
 */
function RenameableTitle({
  slug,
  meta,
  onRenamed,
  children,
}: {
  slug: string;
  meta: Meta;
  onRenamed: (slug: string, title: string) => void;
  children: ReactNode;
}) {
  const rename = useArticleRename(slug, onRenamed);
  return (
    <EditableTitle
      rename={rename}
      title={meta.title}
      inputClassName="tw:font-prose tw:text-2xl tw:leading-snug"
    >
      {children}
    </EditableTitle>
  );
}
