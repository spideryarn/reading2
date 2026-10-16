# Getting a page behind a bot check: extensions, bookmarklets, open-access copies

Up: [research.md](../project/research.md)

What other read-later and reference tools do when a site refuses a server but lets a person through,
and what that leaves for Spideryarn. Asked by Greg on 2026-10-15 (`spya-x5e966`), after
`cell.com/fulltext/S1364-6613(15)00180-1` came back `[fetch-refused]`:

> I can see it in my browser (though there was a check of some kind to verify that I'm human, so I
> had a suspicion this might happen). What can we do to solve this for users going forwards? A
> browser extension? Something else?
>
> Use Sonnet to search the web for ideas/best practices/etc.

The plan that acts on it is
[261015a](../plans/261015a-a-site-that-refuses-the-app-a-better-way-round-and-the-bigger-options-for-greg.md).
The web search was a Sonnet subagent's; the probes from the box are mine. **Verified** means a
request was made and its answer read; everything else is from the sources cited, several of them
second-hand.

## The example, measured

From the box, 2026-10-15, with our browser user-agent:

| Address | Answer |
|---|---|
| `www.cell.com/fulltext/S1364-6613(15)00180-1` | 403 |
| `www.cell.com/article/S1364661315001801/pdf` (OpenAlex's "best open copy") | 403 |
| `doi.org/10.1016/j.tics.2015.08.003` | 200, Elsevier's `linkinghub` redirect page, 3 KB, not the article |
| `europepmc.org/articles/PMC4595480` | 403 |
| `europepmc.org/backend/ptpmcrender.fcgi?…&blobtype=pdf` | 403 |
| `pmc.ncbi.nlm.nih.gov/articles/PMC4595480/` | 200, but the body is a reCAPTCHA challenge page |
| `www.ebi.ac.uk/europepmc/webservices/rest/PMC4595480/fullTextXML` | **200, 136 KB of JATS XML, the full article** |

The registries agree it is open access (Sonnet subagent, re-checked on OpenAlex):

- **Crossref** `works?filter=alternative-id:S1364661315001801` → DOI `10.1016/j.tics.2015.08.003`,
  *Mental Imagery: Functional Mechanisms and Clinical Applications*, CC BY 4.0.
- **OpenAlex** `works/doi:10.1016/j.tics.2015.08.003` → `is_oa: true`, `oa_status: hybrid`,
  `any_repository_has_fulltext: true`, best location the cell.com PDF above (which 403s).
- **Unpaywall** → the same best location; PMC and Europe PMC copies with no PDF address.
- **Europe PMC** search → PMC4595480, `isOpenAccess: Y`.

So **an open copy exists, and every human-facing address for it is walled against us too**. The one
that is not is an API that answers in JATS XML, which the pipeline does not read. "Find the open
copy" is two problems, not one: finding it (cheap, through registries we already call) and reading
it (a converter we do not have).

## How other tools do it

| Tool | What reaches the server | Source |
|---|---|---|
| Readwise Reader | The extension sends the **rendered page** from the browser, which its docs call "the most robust way to save documents". The iOS share sheet from Safari sends content too. Its save-a-URL link is a server fetch, and paywalled pages arrive as stubs. | [Reader docs](https://docs.readwise.io/reader/docs/faqs/adding-new-content) |
| Zotero Connector | Runs in the browser with per-site translators; saves a snapshot and the PDF "if you have access to it". | [Zotero docs](https://www.zotero.org/support/adding_items_to_zotero) |
| Instapaper | Its **bookmarklet** posts the page's HTML from the browser, so signed-in pages work; a plain URL save is a server fetch. In 2025 it added in-app sign-in for hard paywalls. | second-hand: [mjtsai](https://mjtsai.com/blog/?p=4409), [mjtsai 2025](https://mjtsai.com/blog/2025/02/04/instapaper-9-1-and-send-to-kindle-extension) |
| Mendeley Web Importer, Paperpile | In the browser, using the reader's own network or library proxy. | [Paperpile add-on](https://addons.mozilla.org/en-US/firefox/addon/paperpile-addon/) |
| Obsidian Web Clipper, SingleFile | In the browser, saved locally; SingleFile writes one self-contained `.html`. | [Obsidian](https://obsidian.md/help/web-clipper), [SingleFile](https://github.com/gildas-lormeau/SingleFile) |
| Raindrop.io | **Server fetch, on purpose.** It declines to take the page from the reader's browser, citing privacy, and does not support paid content. | [Raindrop help](https://help.raindrop.io/permanent-copy) |
| Hypothesis Via | A server-side proxy, moved to an allow-list after abuse. | [Via docs](https://web.hypothes.is/help/what-is-the-via-proxy/) |
| Pocket, Omnivore | Shut down (Pocket 2025, Omnivore November 2024). | [9to5mac](https://9to5mac.com/2025/05/22/mozilla-announces-shutdown-of-pocket/) |

**The pattern is plain: the tools that get past a wall take the page from the reader's own
browser**, where the person has already passed the check. The ones that fetch from a server meet
the same wall we do. Raindrop is the considered dissent, and its reason is the reader's privacy: a
page taken from your browser carries whatever your browser showed, signed-in details included.

## The options, smallest first

| Option | Gets through | Cost to run | Work | What it changes |
|---|---|---|---|---|
| A clearer sentence, and an upload control where the reader is standing | Anything the reader can open | Nothing | Small | Nothing new: the existing upload path |
| Open-access copy, found automatically | Only papers with an open copy; coverage unmeasured | Free registries | Medium: a DOI step, a lookup, and a JATS→HTML converter | A new service (Europe PMC); the DOI of what a reader adds goes to registries. Kept inside today's boundary only if we take a validated PMC id from the registry and build the address ourselves, never fetching one the registry hands back |
| Bookmarklet that hands the page over | Anything the reader can view, unless the site's CSP stops it | Nothing | Medium, mostly testing across browsers | Cannot POST to us directly: the API takes a Bearer header, not a cookie, so a cross-site request is unauthenticated, and the publisher's page must never hold the reader's token. Needs a handoff: open a signed-in Spideryarn capture page and `postMessage` the HTML to it, which uploads it the usual way |
| Browser extension | Everything the reader can view | Store review, upkeep | Large | `activeTab` is enough (access only to the tab it was clicked on, [Chrome docs](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)); a second codebase; the same handoff as the bookmarklet |
| Share target (PWA) | Not walls: it shares a URL, not the page. Not on iOS Safari (WebKit bug 194593) | Nothing | Medium | — |
| Publisher API (Elsevier TDM) | Licensed content | Licence | Medium | Free for academic non-commercial use; a consumer product is probably not eligible ([dev.elsevier.com](https://dev.elsevier.com/sd_apis.html)) |
| Challenge-solving scraping service | Often, by the vendors' own claims; plain headless rendering does not | Per request | Medium | Fragile as walls change, publishers' terms, and a security burden if a reader's session ever entered the flow. **Not recommended.** |

### Notes that matter for the choice

- **Bookmarklets and CSP.** Mozilla's [bug 866522](https://bugzilla.mozilla.org/show_bug.cgi?id=866522)
  ("Bookmarklets affected by CSP") is still open, and a comment from the Firefox 58 era says they
  were failing on half the sites the commenter visited. A form POST escapes `connect-src` and is
  caught only by `form-action`. None of this was tested on cell.com; it has to be before anything
  is promised. On iOS a bookmarklet has to be installed by hand, which few readers will do.
- **Size.** A Vercel function's request body is capped at about 4.5 MB. The handoff above avoids
  it, because the capture page sends the HTML through the upload path, which goes straight to
  Storage.
- **What to save.** The upload accepts `.pdf`, `.html`, `.txt`, `.md` and `.docx`
  ([ingest-queue.md § Uploading a PDF](../project/ingest-queue.md#uploading-a-pdf)). Safari saves a
  `.webarchive` by default and Chrome's "single file" is `.mhtml`; neither is taken. So the
  refusal recommends a PDF: the journal's own **Download PDF** first, the publisher's typeset
  file, then the page saved as a PDF, which every browser can do. An HTML file would be free to
  read, where a PDF costs a model call, but no browser offers one by that name.
- **Open-access coverage.** Not measured. Hybrid gold articles like this one are the easy case;
  for a closed article the repository copy is often an accepted manuscript, not the published
  version. Sample twenty real refused links before building.

## Recommendation

1. **Now, inside what we have:** say the better way round, and put the upload where the reader is
   told to use it. Built in the plan.
2. **Then, Greg's call, cheapest first:** the open-access lookup, measured on twenty real refused
   links before building; then a bookmarklet, prototyped on cell.com in Chrome, Firefox and Safari;
   an extension only if the bookmarklet proves too fragile.
