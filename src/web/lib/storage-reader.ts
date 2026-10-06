/**
 * **Whose a record in this browser's storage is**, as the word that goes in
 * its key or its value: the reader's id, or `signed-out` for nobody.
 *
 * Two readers can use one browser profile, so anything kept in `localStorage`
 * that is a reader's own (the place they were in an article, the words they
 * searched for) names that reader, and is read back only for them. The rule
 * and the two stores that follow it are in docs/project/auth.md § Browser
 * storage that is a reader's is keyed by that reader.
 *
 * One function so the two cannot spell "nobody" differently. A reader's id is
 * a uuid, so it can never be this word, and neither has a dot in it.
 */
export const SIGNED_OUT = "signed-out";

export function storageReader(readerId: string | null): string {
  return readerId ?? SIGNED_OUT;
}
