/**
 * **C0 control characters other than tab, line feed and carriage return**, and DEL.
 *
 * None is ever on a printed page, and the strangers who write text for us
 * produce them. pdf.js does, where a font has no usable ToUnicode map: a maths
 * font's minus sign comes out as U+0002. And a model does, when it transcribes
 * such a page: job spya-k0ytd8 got a U+0000, which Postgres will not store in
 * `text` (22021) or `jsonb` (22P05), so first its checkpoint and then the whole
 * article were refused. docs/plans/261019h, and the class is
 * docs/postmortems/261019c-foreign-text-cleaned-for-the-noise-we-had-seen-not-for-what-the-database-can-hold.md.
 *
 * So text from outside is cleaned **where it comes in**, once per entrance:
 *
 *   - pdf.js's stage-2/metadata text runs and Info title — `itemText` in src/pdf.ts;
 *   - a PDF transcription, fresh or replayed from a checkpoint —
 *     `validateChunkReading` in src/pdf-integrity.ts, which every reading passes;
 *   - the paper-metadata model's answer — `oneLine` in src/paper-metadata.ts;
 *   - a Crossref or DataCite string or DOI — `plainRegistryText` and
 *     `normaliseDoi` in src/bibliographic.ts.
 *
 * Downstream code can rely on these strings being clean; there is no storage
 * backstop that silently rewrites them.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: replacing these characters is the point
export const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * Each control character becomes a space, **not nothing**: a control between
 * two letters stood for something, and deleting it would join two words into
 * one the page does not have, which the PDF scorer then counts as a miss. The
 * rule src/html.ts § `normaliseText` follows for the same reason. Callers that
 * want single spaces already collapse them.
 */
export function controlsAsSpaces(text: string): string {
  return text.replace(CONTROL_CHARACTERS, " ");
}
