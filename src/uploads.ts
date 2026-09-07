/**
 * What counts as a file worth uploading, decided in one place.
 *
 * **Two kinds since 2026-09-07** — a PDF and a web page — and one function says
 * which (`uploadKind`). Before that this module was named entirely around PDFs,
 * and several sentences below still lead with one because a PDF is where every
 * one of the hard-won details came from.
 *
 * A module of its own for the same reason src/ingest.ts is one: **the answer
 * has to be the same in the browser and on the server**, and they are different
 * processes. Today only the file picker in src/web/AddArticle.tsx asks — the
 * rest of the upload path is planned and not built, see
 * docs/plans/260826u-pdf-upload-and-storage.md — but the picker refusing a file the
 * server would have accepted, or worse the other way round, is the kind of
 * disagreement that is invisible until somebody is holding a 60 MB scan.
 *
 * No dependencies, no DOM types: the browser imports this, and so will
 * `POST /api/uploads` when it exists.
 *
 * **The checks here are the cheap ones, and they are not the real ones.** A
 * name ending in `.pdf` and a browser-guessed MIME type are both claims made by
 * whoever chose the file. The check that matters is the `%PDF-` magic over the
 * bytes that actually arrived, and it belongs on the server, after the upload,
 * before anything expensive — the plan's `verify-source` step. Nothing here
 * should ever be mistaken for it.
 */

/**
 * The largest file we will take, in bytes.
 *
 * 50 MiB, and the number is not ours: it is the ceiling Supabase's free plan
 * puts on a single object, and `[storage] file_size_limit` in
 * supabase/config.toml is already set to it. Raising this needs a billing
 * decision before it needs a code change.
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * The most pages we will read in one document.
 *
 * A cost cap, not a capability one: roughly a dollar per hundred pages of
 * transcription.
 *
 * **250 since 2026-09-04, up from 100.** Greg's call, and the document that
 * prompted it is the argument: a 142-page journal paper is exactly what this
 * app is for, and it was refused. Two things had to be true before the number
 * could move, and both are:
 *
 * - **A retry keeps the article**, so the per-chunk checkpoints a first attempt
 *   paid for are reachable by a second (`slugForRetry` in src/jobs.ts). Without
 *   that, raising the cap makes a long PDF fail *for ever* rather than fail
 *   once — every attempt starting from zero and re-buying every chunk.
 * - **`CHUNK_CONCURRENCY` is wide enough that 250 pages of ordinary prose fit
 *   the deadline**; the arithmetic is in src/pdf-read.ts, written against this
 *   number — and note that it does *not* claim the pathological case fits.
 *
 * **Where it is enforced is not where it is spent.** Stage 1 counts the pages
 * and refuses before the document is stored (src/pipeline.ts §
 * `refuseAnOverlongPdf`), so the reader hears it in seconds. `pass0`'s guard in
 * src/pdf-read.ts stays as the backstop, for an article ingested before that or
 * re-extracted after this number moves again.
 *
 * **Here rather than beside that arithmetic, since 2026-09-04.** src/pdf-read.ts
 * owned it, and that module pulls in pdf.js and p-queue, so the browser could
 * not name the number — which meant the only way to find out a document was too
 * long was to upload it and be refused, and src/messages.ts §
 * `UPLOAD_TOO_MANY_PAGES` had to be written without it. This module is the one
 * both sides already share, for exactly this reason, and it is where
 * `MAX_UPLOAD_BYTES` already lived. The essay about *why 250 is safe* stays with
 * the arithmetic it is about; the number lives here.
 */
export const MAX_PAGES = 250;

/**
 * What we will take, said before the reader has chosen anything.
 *
 * **A limit nobody hits is worth stating; a limit somebody hits is worth
 * stating twice.** The page cap especially: a reader can see a file's size in
 * their own file manager before they pick it, and cannot see its page count
 * without opening it — so it was discoverable only by uploading a book and
 * being turned away at the end. That is what
 * Sentry `SPIDERYARN-READING2-V` was, from the other side.
 *
 * Both numbers come from the constants above, so this cannot promise a limit
 * that is not the one enforced. Both are also, deliberately, the *same* numbers
 * the refusals name — `uploadProblem` below for the size and src/messages.ts §
 * `pdfTooManyPages` for the pages.
 */
export function uploadLimits(): string {
  return `PDF or web page, up to ${formatBytes(MAX_UPLOAD_BYTES)}. PDFs up to ${MAX_PAGES} pages.`;
}

/** What the reader chose, in the small part of `File` that matters here. */
export interface ChosenFile {
  name: string;
  /** The browser's guess. Empty string is common and is not a refusal. */
  type: string;
  size: number;
}

/**
 * Why we cannot take this file, or `null` if we can.
 *
 * A whole sentence, written to be shown as-is — docs/project/copy.md. Each one
 * says what is wrong with *this* file and what would work instead, because
 * every refusal here is one the reader can act on by choosing differently.
 *
 * ## The `pick-` codes, and why they exist now ⟨GPT Sol, 2026-09-04⟩
 *
 * These carried **no bracketed code** until 2026-09-04, on the argument that
 * they "never involve a provider or a request, so there is nothing for anybody
 * to look up". That was the wrong test. A code names an authored branch; the
 * `mic-` family already establishes that a failure the browser raises entirely
 * on its own is worth naming (docs/project/copy.md).
 *
 * And the report that changed it is the argument. Somebody pressed Feedback and
 * wrote, in full, *"couldn't upload PDF"* — which could have been any of seven
 * things: this module's three, the page cap, the quota wall, a transfer that
 * died, or extraction failing hours later. Four characters would have settled
 * it. The support value exists before a single byte is sent.
 *
 * **`pick-`, not `up-`.** The `up-` family is the *upload record's* refusals,
 * which happen on the server over the bytes that actually arrived. These three
 * happen in the browser over a name and a MIME type the reader's OS supplied.
 * Somebody quoting `[pick-pdf]` has told you the picker never sent anything;
 * `[up-pdf]` would have told you the opposite. They are not in `CODE_KINDS`
 * because nothing classifies them — `kindOfMessage` returns `null` for an
 * unknown code and `QuotaNotice` renders anything that is not a `pay-` code as
 * plain prose, which is exactly right for a refusal with no button under it.
 */
export function uploadProblem(file: ChosenFile): string | null {
  if (uploadKind(file) === null) {
    /* **"Doesn't look like"**, not "isn't". All this saw was a name and the
       browser's guess at a type, and `uploadKind` is deliberately generous
       about both. The check that can be certain is over the bytes, on the
       server. A sentence more certain than its evidence is one the reader
       catches us out on the day it is wrong.

       **The code stays `[pick-pdf]` now that a second kind is legal**, and that
       is deliberate. A code names a branch so that somebody can quote four
       characters and be understood (docs/project/copy.md), and this is the same
       branch it always was — renaming it would strand every report that already
       quotes it in exchange for a tidier spelling. */
    return (
      "That doesn't look like a PDF or a web page. Uploads are PDF and HTML files — or a web " +
      "address can go in the box above instead. [pick-pdf]"
    );
  }
  if (file.size === 0) {
    return "That file is empty. It may still be downloading, or syncing from somewhere else. [pick-empty]";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That's ${formatBytes(file.size)}, and the limit is ${formatBytes(MAX_UPLOAD_BYTES)}. [pick-big]`;
  }
  return null;
}

/**
 * **What this file claims to be**, before anybody has looked at a single byte —
 * or `null` for a claim we will not take.
 *
 * **Either the type or the name**, rather than both. Browsers disagree about
 * `File.type`: it is `application/pdf` from most file pickers, and it is the
 * empty string often enough — a drag from an archive tool, a file whose
 * extension the OS does not know — that requiring it would refuse perfectly
 * good files. And the name alone is not enough either, because a picker can
 * hand over a `.PDF` with any type at all. So this is deliberately generous,
 * and the strict check happens over the bytes on the server.
 *
 * **A second kind since 2026-09-07**, which is what
 * docs/plans/260907b-upload-an-html-file-and-a-url-for-a-pdf.md is about — and note
 * what this function now is and is not. It answers the same question
 * `sniffKind` (src/fetch.ts) answers, which is why it returns a kind rather
 * than a boolean; but it answers it from a **claim**, and the two are allowed
 * to disagree. A `.html` whose bytes begin `%PDF-` is a PDF, and
 * `acquireUpload` is where that is settled.
 *
 * This module deliberately does not import `DocumentKind` for the return type.
 * It has no dependencies at all — that is the whole reason it exists, so the
 * browser can hold it — and src/fetch.ts brings the network stack with it.
 * `tests/uploads.test.ts` pins that the two spellings stay the same two words.
 */
export function uploadKind(file: ChosenFile): "pdf" | "html" | null {
  if (file.type === "application/pdf") return "pdf";
  if (file.type === "text/html") return "html";
  const name = file.name.toLowerCase();
  const html = name.endsWith(".html") || name.endsWith(".htm");

  /* **No usable guess** — the empty string, or a shrug. The name decides. */
  if (file.type === "" || file.type === "application/octet-stream") {
    if (name.endsWith(".pdf")) return "pdf";
    return html ? "html" : null;
  }

  /* **A type the OS was definite about, and it is neither of ours.** The name
     does not get to overrule it, so a `.pdf` the browser is sure is an archive
     is refused here rather than after the transfer.

     **One exception, and it is not a softening of that rule.** `text/plain` on
     a `.html` is not a contradiction — a web page *is* text, and an OS that
     does not know the extension says exactly this — so refusing it would turn a
     good file away on the strength of a guess. `sniffKind` (src/fetch.ts) calls
     `text/plain` vague for the same reason. It stays a refusal for a `.pdf`,
     where it *is* a contradiction, which is a distinction
     `tests/uploads.test.ts` was already pinning before this second kind existed
     and which a blanket "treat text/plain as vague" would have broken.
     ⟨Sol, 2026-09-07, raised the case; the split is the answer to it.⟩ */
  return file.type === "text/plain" && html ? "html" : null;
}

/**
 * **The `Content-Type` the browser puts on its PUT to Storage.**
 *
 * The bucket has an allowlist and enforces it against the service key too
 * (`allowed_mime_types` in supabase/config.toml; what it costs to get that
 * wrong is docs/postmortems/260828a-the-config-file-is-not-the-bucket.md), so a
 * mislabelled file is refused at the door with a 415 rather than after 50 MB.
 *
 * It is still only a **claim**, checked against the bytes on the server — which
 * is exactly why it belongs here, in the module both sides share, rather than
 * being spelled out as a literal in src/web/upload.ts. That literal was
 * `application/pdf` for every file until 2026-09-07, which is the one line that
 * would have made an HTML upload fail at the bucket with a status nobody could
 * read.
 *
 * Falls back to `application/pdf` for a file `uploadKind` refused, because
 * `uploadProblem` has already stopped that file and there is no PUT to label.
 */
export function uploadContentType(file: ChosenFile): string {
  return uploadKind(file) === "html" ? "text/html" : "application/pdf";
}

/**
 * A size a person can read, in the units a file manager uses.
 *
 * Powers of 1024 with the short names, which is what macOS's Finder, Windows
 * and every download manager show — matching them matters more here than being
 * right about SI, because the number the reader compares this against is the
 * one their own machine printed.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  // One decimal under 100 MB, none above: "6.1 MB" is worth saying and
  // "104.7 MB" is false precision about a number nobody is checking. And no
  // trailing `.0`, because the round numbers this prints are usually the
  // *limits* — "up to 50 MB", not "up to 50.0 MB", which reads like a measurement
  // of something rather than a rule.
  if (mb >= 100) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1).replace(/\.0$/, "")} MB`;
}
