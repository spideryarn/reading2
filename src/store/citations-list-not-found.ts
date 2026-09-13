/**
 * The citations stage has not made a list for this article yet.
 *
 * A type, not merely `status: 404`: `loadCitations` can also return a 404 when
 * the article itself disappeared. Chat may call only this error "no list";
 * every other 404 is a read failure, not evidence about which artefacts exist.
 */
export class CitationsListNotFound extends Error {
  readonly status = 404;

  constructor() {
    super("No citations list has been made for this article.");
    this.name = "CitationsListNotFound";
  }
}
