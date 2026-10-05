/**
 * **The head of a public article, read with no key**, for the suites that are
 * about what a head contains rather than about who may have one.
 *
 * `loadHead` answers a union since the private link arrived (plan 261005e):
 * a public article's head, or the bare fact that a private one was opened by
 * its key. Every caller here means the first, and a fixture that came back as
 * the second would be a private article in a test that believes it is public,
 * so that is an error with its own sentence rather than an `undefined` title
 * three assertions later.
 */

import { PUBLIC_ONLY } from "../../src/store/public-access.js";
import { type PublicHead, pgPublicReader } from "../../src/store/public-reader.js";

export async function publicHeadOf(slug: string): Promise<PublicHead> {
  const found = await pgPublicReader.loadHead(slug, PUBLIC_ONLY);
  if (found.sharedBy !== "public") {
    throw new Error(`"${slug}" was read with no key and did not come back as a public article.`);
  }
  return found.head;
}
