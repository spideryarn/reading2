/**
 * What counts as a PDF worth uploading, decided in one place.
 *
 * A module of its own for the same reason src/ingest.ts is one: **the answer
 * has to be the same in the browser and on the server**, and they are different
 * processes. Today only the file picker in src/web/AddArticle.tsx asks — the
 * rest of the upload path is planned and not built, see
 * docs/plans/pdf-upload-and-storage.md — but the picker refusing a file the
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
 * There is no code in brackets: these never involve a provider or a request,
 * so there is nothing for anybody to look up.
 */
export function uploadProblem(file: ChosenFile): string | null {
  if (!looksLikePdf(file)) {
    return "That isn't a PDF. Uploads are PDFs for now — a web page can go in the box above instead.";
  }
  if (file.size === 0) {
    return "That file is empty. It may still be downloading, or syncing from somewhere else.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That's ${formatBytes(file.size)}, and the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`;
  }
  return null;
}

/**
 * A PDF as far as anything before the bytes can tell.
 *
 * **Either the type or the name**, rather than both. Browsers disagree about
 * `File.type`: it is `application/pdf` from most file pickers, and it is the
 * empty string often enough — a drag from an archive tool, a file whose
 * extension the OS does not know — that requiring it would refuse perfectly
 * good files. And the name alone is not enough either, because a picker can
 * hand over a `.PDF` with any type at all. So this is deliberately generous,
 * and the strict check happens over the bytes on the server.
 */
function looksLikePdf(file: ChosenFile): boolean {
  if (file.type === "application/pdf") return true;
  if (file.type !== "" && file.type !== "application/octet-stream") return false;
  return file.name.toLowerCase().endsWith(".pdf");
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
  // "104.7 MB" is false precision about a number nobody is checking.
  return mb < 100 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}
