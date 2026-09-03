/**
 * **Where a plate's bytes go, and the three things checked before they go
 * there.**
 *
 * `generateIllustrated` (src/illustrated.ts) hands back one `PlateDraw` per
 * image call, each carrying raw bytes, and its comment says *"the caller
 * decides where these bytes go"*. This is that decision: the bytes go to the
 * blob store under `canonicalKey(sha256, "jpeg")` — the same machinery the
 * article's own figures use — and what comes back is the `IllustratedImage`
 * record the artefact holds. **Never base64 in the artefact**: that column
 * would then be dragged along by every read of the revision
 * (src/illustrated-plate.ts § `IllustratedImage`).
 *
 * ## Why it refuses rather than stores whatever arrived
 *
 * The key ends in `.jpeg` and the object is stored as `image/jpeg`, so those
 * two are a promise about the bytes. `output_format: "jpeg"` is honoured by
 * `openai/gpt-image-2` **despite not appearing in that model's
 * `supported_parameters`** (plan § Storage), which is exactly the shape of thing
 * that stops being true one day without anybody being told. If a future model
 * quietly returns PNG, this must fail loudly here rather than write a `.jpeg`
 * object that is not one and leave a reader's browser to work it out.
 *
 * It does **not** re-sniff the signature to find that out. `readPlate` in
 * src/ai-call.ts already decides the media type from the bytes' own magic
 * numbers and refuses a provider whose claim disagrees, so `PlateDraw.mediaType`
 * is already the earned answer rather than the claimed one, and a second
 * statement of the JPEG magic bytes here would be a second thing to keep in
 * step. One place decides what the bytes are; this decides whether that is
 * allowed.
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
import type { IllustratedImage } from "./illustrated-plate.js";
import { type RawSourceStore, blobStore, storeRawSource } from "./store/blobs.js";

/** What the plate's bytes must be, spelled once. */
export const PLATE_MEDIA_TYPE = "image/jpeg";

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
  if (draw.mediaType !== PLATE_MEDIA_TYPE) {
    throw new Error(
      `the illustrator returned ${draw.mediaType ?? "bytes of no stated type"} and a plate ` +
        `must be ${PLATE_MEDIA_TYPE} — see src/illustrated-image.ts`,
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

  const { sha256 } = await storeRawSource(draw.image, "jpeg", store);
  return { sha256, ext: "jpeg", bytes: draw.image.byteLength, width: size.width, height: size.height };
}
