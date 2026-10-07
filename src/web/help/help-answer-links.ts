/**
 * **Where an answer from *Ask about Spideryarn* may link**: exactly the
 * addresses of the Help's own pages, and `/help`. Plan
 * docs/plans/261007k-help-chatbot.md, § After the plan review, F4.
 *
 * The answer is a model's output, so an address in it is untrusted
 * (docs/project/security-map.md). The prompt (src/help-chat-call.ts) asks the
 * model to link only the `Address:` lines it was given; this is what holds
 * when it does not. **Exact match, nothing else**: no prefix rule, no
 * normalising a trailing slash or a case, no relative path resolved, so the
 * only links drawn are ones a person wrote into the Help. Anything else is
 * drawn as the characters the model typed (src/web/Cited.tsx § `ownLink`).
 *
 * The list is `helpHref` over `HELP_GROUPS`, which is how
 * tests/help-corpus.test.ts builds the corpus's `href`s — so the two are the
 * same list by construction, and tests/help-answer-links.test.ts checks it.
 * Not read from src/help-corpus.generated.json: that is ~95 kB of the pages'
 * words, already in this bundle once as the pages themselves.
 */
import { HELP_HREF } from "../router.js";
import { helpHref } from "./help-anchors.js";
import { HELP_GROUPS } from "./help-content.js";

let allowed: ReadonlySet<string> | null = null;

/** Every address an answer may link, built on first use. */
export function helpAnswerHrefs(): ReadonlySet<string> {
  allowed ??= new Set([HELP_HREF, ...HELP_GROUPS.flatMap((g) => g.anchors.map((a) => helpHref(a)))]);
  return allowed;
}

/** `url` when it is exactly one of the Help's own addresses, otherwise null. */
export function helpAnswerHref(url: string): string | null {
  return helpAnswerHrefs().has(url) ? url : null;
}
