# Coercive validation trusts malformed JSON hashes

Up: [postmortems.md](../project/postmortems.md)

Found during the stage 2 review of
[link previews and SEO](../plans/261005f-link-previews-and-seo-for-shared-links.md), before committing
the stage. The introduction is the uncommitted additions of `leadImageOf` and `leadImageUrl` in the
[review diff](../plans/261005f-link-previews-stage-2-code-review.diff); there is no introducing commit
yet. A separate review agent confirmed the cause from the database read to response composition.

The database image manifest is JSON, but the selector cast its entries to a TypeScript union and
checked only status, extension and bytes. It returned an unchecked hash. The URL builder's regular
expression then coerced that value: an array containing a valid hash passed, and a JSON object
with `toString: null` threw. The array produced a card URL whose asset lookup rejected the hash;
the object broke response composition. An invalid first hash also hid the next valid picture.

The class is **trusting an erased type at a JSON boundary, followed by coercive validation**.
Checking after selecting the first match compounded it: rejection at the URL builder could only
fall back to the brand image, not continue to the next picture.

The fix validates hash type, hash format and extension with `isLeadImage` in
[`asset-delivery.ts`](../../src/asset-delivery.ts), both during selection and at the URL builder.
It rejects non-finite byte counts too. This is also the long-term fix: keep validation beside the
small projection rather than treating a database cast as runtime validation.

What would have caught the class, ranked by ease against value:

1. **Malformed JSON cases at selection and at the URL builder.** Added to
   [`lead-image.test.ts`](../../tests/lead-image.test.ts). Arrays, objects and an invalid entry before
   a valid successor expose both failures. The new hash tests failed before the fix.
2. **Check the runtime type before coercive validators.** A small string check prevents a regex
   from silently accepting an array or throwing on an object; the shared predicate now does this.
3. **Validate every existing manifest in a database migration.** Rejected: this costs a corpus scan
   and still leaves later reads dependent on unchecked writes. The request boundary needs the guard
   regardless.
