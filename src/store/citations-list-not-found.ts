import { ArtefactNotMadeYet } from "./artefact-not-made-yet.js";

/**
 * The citations stage has not made a list for this article yet.
 *
 * A type, not merely `status: 404`: `loadCitations` can also return a 404 when
 * the article itself disappeared. Chat may call only this error "no list";
 * every other 404 is a read failure, not evidence about which artefacts exist.
 *
 * A subclass of `ArtefactNotMadeYet` since 2026-10-06 — the same fact, for the
 * one artefact that had a name for it first — so the route's "none yet" helper
 * catches it with quiz's and crossrefs', and chat's `instanceof` still holds.
 */
export class CitationsListNotFound extends ArtefactNotMadeYet {
  constructor() {
    super("No citations list has been made for this article.");
    this.name = "CitationsListNotFound";
  }
}
