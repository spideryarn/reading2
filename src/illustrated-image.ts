/**
 * **Where a plate's bytes go, and the three things checked before they go
 * there.**
 *
 * `generateIllustrated` (src/illustrated.ts) hands back one `PlateDraw` per
 * image call, each carrying raw bytes, and its comment says *"the caller
 * decides where these bytes go"*. This is that decision: the bytes go to the
 * blob store under `canonicalKey(sha256, ext)` — the same machinery the
 * article's own figures use — and what comes back is the `IllustratedImage`
 * record the artefact holds. **Never base64 in the artefact**: that column
 * would then be dragged along by every read of the revision
 * (src/illustrated-plate.ts § `IllustratedImage`).
 *
 * ## Why it refuses rather than stores whatever arrived
 *
 * The key ends in the extension and the object is stored under the matching
 * content type, so those two are a promise about the bytes. It is a closed set
 * of two — JPEG and PNG — and anything else is refused rather than stored under
 * a name that is not true. **That refusal has already fired once**: the plan
 * predicted that `output_format: "jpeg"`, honoured by `openai/gpt-image-2`
 * despite not appearing in its `supported_parameters`, "stops being true one
 * day without anybody being told". It did, on 2026-09-04, when the illustrator
 * changed to `google/gemini-3.1-flash-image`, which ignores the field and
 * returns PNG. What that cost was one line of this file, because the check was
 * here.
 *
 * ## PNG, and why we do not re-encode it
 *
 * A 1K plate is about **1.9 MB of PNG** against about 150 KB of JPEG, so this
 * is not free: four plates is ~7.6 MB of storage per illustrated article, and
 * the reader downloads one of them to look at it. It is stored anyway, because
 * the alternative is worse in a way that is measured rather than argued:
 *
 *  - **Re-encoding needs a decoder, and the only one here is banned from this
 *    bundle.** `@napi-rs/canvas` is already a dependency and would do it in
 *    three lines — and naming it from anything the API function reaches adds
 *    **34 MB** to the Vercel bundle, which is why
 *    `tests/pdf-bundle-trace.test.ts` lists `@napi-rs/canvas/index.js` under
 *    `MUST_NOT_SHIP`. The illustrated step runs inside that function.
 *    src/feedback-image.ts § JPEG is refused made the same call for the same
 *    reason, and refusing there was the right answer too.
 *  - **A hand-rolled JPEG encoder is a DCT and a Huffman table**, which is a
 *    real piece of work to own for a saving in bytes, and a new dependency is
 *    what the plan deliberately did without.
 *  - **The money is not here.** An illustrated article costs $0.27–$0.40 of
 *    model spend; 7.6 MB of Supabase Storage is rounding error beside it. What
 *    it does cost is the reader's download, and that is named in
 *    docs/project/diagram.md so the next person can weigh it rather than
 *    discover it.
 *
 * If the download turns out to matter, the two ways forward are the 34 MB or a
 * baseline encoder, and that is Greg's call rather than one to make inside a
 * model swap.
 *
 * It does **not** re-sniff the signature to find that out. `readPlate` in
 * src/ai-call.ts already decides the media type from the bytes' own magic
 * numbers and refuses a provider whose claim disagrees, so `PlateDraw.mediaType`
 * is already the earned answer rather than the claimed one, and a second
 * statement of the magic bytes here would be a second thing to keep in step.
 * One place decides what the bytes are; this decides whether that is allowed,
 * and under which name they are stored.
 *
 * ## Orphans are accepted, and no sweep is built
 *
 * The blob store is content-addressed and create-only, so a run that draws two
 * plates and then fails leaves two objects nothing references. That is v1's
 * policy rather than an oversight (plan § Two hazards): the plates that were
 * paid for are kept, the artefact is written once at the end, and the next
 * identical run dedups straight onto those same objects — `putIfAbsent` answers
 * `already-there` and no bytes move. An orphan costs about 150 KB and nothing
 * else. **If you are about to write a sweep, read that section first**: a
 * garbage collector over content-addressed blobs has to be right about every
 * artefact in every revision that could still reference a hash, and getting it
 * wrong deletes a picture a reader is looking at.
 */
import { imageDimensions } from "./assets.js";
import type { IllustratedImage, IllustratedImageExt } from "./illustrated-plate.js";
import { type RawSourceStore, blobStore, storeRawSource } from "./store/blobs.js";

/**
 * **What a plate may be, and under which name it is stored** — spelled once,
 * and a closed map rather than two lists that could drift apart.
 *
 * The key is what `readPlate` (src/ai-call.ts) earned from the bytes' own
 * signature; the value is what goes into `canonicalKey` and therefore into the
 * URL, the `Content-Type` header and the object's own metadata. Reading the
 * extension out of the media type rather than deciding it separately is what
 * makes "the key ends in `.png`" and "the bytes are a PNG" one fact.
 */
export const PLATE_MEDIA_TYPES: Readonly<Record<string, IllustratedImageExt>> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
};

/**
 * Put one plate in the blob store and hand back the record the artefact keeps.
 *
 * Throws on anything it cannot vouch for, and the caller records that on the
 * plate as a `failed` sentence rather than losing the run — the same treatment a
 * failed image call gets, because from the reader's side they are the same
 * event: this plate has no picture.
 *
 * `store` is injectable so a test can exercise the refusals without a
 * container; the default follows the credentials the way everything else here
 * does (src/store/blobs.ts § Why selection does not read `SPIDERYARN_STORE`).
 */
export async function storePlateImage(
  draw: { image: Uint8Array; mediaType?: string },
  store: RawSourceStore = blobStore(),
): Promise<IllustratedImage> {
  const ext = draw.mediaType === undefined ? undefined : PLATE_MEDIA_TYPES[draw.mediaType];
  if (!ext) {
    throw new Error(
      `the illustrator returned ${draw.mediaType ?? "bytes of no stated type"} and a plate ` +
        `must be ${Object.keys(PLATE_MEDIA_TYPES).join(" or ")} — see src/illustrated-image.ts`,
    );
  }
  if (draw.image.byteLength === 0) throw new Error("the illustrator returned an empty plate");

  /* Read before the write, so a picture whose header we cannot follow never
     reaches the store: `width`/`height` are not decoration, they are what the
     panel reserves space with, and a record carrying zeroes would lay the band
     out wrong on every later read of a perfectly good object. */
  const size = imageDimensions(draw.image);
  if (!size || size.width < 1 || size.height < 1) {
    throw new Error("the illustrator's plate does not say what size it is");
  }

  const { sha256 } = await storeRawSource(draw.image, ext, store);
  return { sha256, ext, bytes: draw.image.byteLength, width: size.width, height: size.height };
}
