/**
 * **The picture the reader took themselves, turned into bytes the server will
 * take.**
 *
 * The client half of the screenshot field on `POST /api/feedback` —
 * docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md. A `File`
 * comes in, from a paste, a drop or a file input; canonical base64 of a PNG
 * goes out, which is the only thing the route's `screenshot` field accepts.
 *
 * ## There is no one-click capture, and that is a decision rather than a gap
 *
 * The reader presses ⌘⇧4 (macOS) or PrtScn (Windows) and pastes. The plan's
 * [screenshot spike](../../docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md#the-screenshot-spike)
 * has the whole argument; the short of it is that `html2canvas` cannot parse
 * `oklch()`, which is what Tailwind v4 emits 39 times in our compiled CSS, so
 * the most-pretrained-on option is the one that would visibly misrender every
 * screenshot it took; `@zumer/snapdom` is the best technical fit and fails this
 * repo's headline library criterion; and `getDisplayMedia` has no iOS Safari at
 * all. Paste costs fifty lines, needs no permission prompt, and **cannot break
 * on our CSS because it never touches our CSS**.
 *
 * ## Why everything goes through a canvas even when it is already a PNG
 *
 * The round trip is what makes a pasted JPEG work. The server refuses JPEG
 * outright (src/feedback-image.ts argues why: a JPEG's entropy-coded scan
 * cannot be length-checked, so prose appended to one would survive), and a
 * reader's clipboard hands over whatever their OS put in it. Re-encoding here
 * means the file leaving the browser is a PNG whatever arrived — **so in
 * practice that refusal is invisible**, and the next reader of it should know
 * that before wondering why nobody ever hits it.
 *
 * It also throws away everything that is not pixels: EXIF, colour profiles,
 * text chunks, the original filename. The server takes the file apart and
 * writes it again from the raster regardless, so this is belt and braces on
 * purpose — work done in a browser is never validation, only the first half.
 *
 * ## What this module does not do
 *
 * No DOM event listeners: `imageFileFromPaste` and `imageFileFromDrop` are pure
 * extractors, and the dialog owns the `paste` handler, the drop zone and the
 * `preventDefault`. That seam is what lets the whole pipeline be tested without
 * mounting a component — tests/feedback-screenshot.test.ts.
 *
 * And no `URL.createObjectURL`, so there is nothing to revoke:
 * `createImageBitmap` decodes a `Blob` directly. The `<img src=objectURL>` dance
 * is only needed on browsers without it, and the last of those (Safari 14) is
 * years behind our floor.
 */
import { MAX_FEEDBACK_SCREENSHOT_BYTES } from "../types.js";

/**
 * The longest edge we send, in pixels.
 *
 * Comfortably inside `MAX_SCREENSHOT_EDGE` in src/feedback-image.ts, which is
 * the absolute the server refuses past — that relationship is pinned by
 * tests/feedback-screenshot.test.ts rather than restated here, because
 * src/feedback-image.ts needs `node:zlib` and so may never be imported into the
 * browser bundle (tests/client-imports.test.ts).
 *
 * 1600 is enough to read our own UI back off a screenshot taken on a 2×
 * display, and small enough that a full-screen capture lands inside
 * `MAX_FEEDBACK_SCREENSHOT_BYTES` with room to spare.
 */
export const SCREENSHOT_LONG_EDGE = 1600;

/**
 * Why a screenshot did not become a field. **A closed set**, because the dialog
 * turns each one into a sentence for the reader and there is nothing else it
 * could usefully say.
 *
 * `unreadable` is deliberately the answer to three different mechanical
 * failures — a file that is not really an image, a decoder that refused it, a
 * canvas that produced nothing — because all three mean the same thing to act
 * on: take the screenshot again.
 */
export type ScreenshotProblem = "not-an-image" | "too-big" | "unreadable";

/**
 * A screenshot ready for the wire, or the reason there isn't one.
 *
 * A discriminated union rather than a bag of optionals: `base64` exists exactly
 * when there is a picture, so "failed, but here are some bytes" is a state the
 * compiler refuses rather than one every caller has to remember not to write.
 */
export type ScreenshotOutcome =
  | { ok: true; base64: string; width: number; height: number; bytes: number }
  | { ok: false; problem: ScreenshotProblem };

/**
 * The size to draw at: the long edge capped, the aspect ratio kept, and **never
 * bigger than it arrived**.
 *
 * The capped edge is assigned the constant rather than computed from the scale,
 * so a downscaled screenshot is exactly 1600 on its long side rather than 1599
 * because of a float. The other edge rounds, and is floored at 1 so that a
 * one-pixel strip stays a picture a canvas will accept.
 */
function fitWithin(width: number, height: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= SCREENSHOT_LONG_EDGE) return { width, height };
  const scale = SCREENSHOT_LONG_EDGE / long;
  return width >= height
    ? { width: SCREENSHOT_LONG_EDGE, height: Math.max(1, Math.round(height * scale)) }
    : { width: Math.max(1, Math.round(width * scale)), height: SCREENSHOT_LONG_EDGE };
}

/**
 * Base64 in chunks, because the one-liner breaks on real files.
 *
 * The same code and the same reason as `base64` in ./dictation-upload.ts:
 * `btoa(String.fromCharCode(...bytes))` throws `RangeError: Maximum call stack
 * size exceeded` somewhere around a hundred thousand arguments, so it works on
 * every fixture anybody writes by hand and fails on the first real screenshot.
 * Copied rather than shared: the sibling is six lines inside a module that pulls
 * the whole API client behind it, and importing it for this would be the worse
 * of the two couplings.
 */
function base64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

/** `toBlob` is callback-shaped, and **can hand back `null`**. Both, awaited. */
function toPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

/**
 * **A screenshot, downscaled and re-encoded as PNG, ready to be posted.**
 *
 * Never throws: every failure is a `problem`, because the caller is a dialog
 * that has to say a sentence either way and an exception there would take the
 * reader's typed report down with it.
 */
export async function screenshotFromFile(file: File): Promise<ScreenshotOutcome> {
  /* A declared type that is not an image is the one refusal worth making before
     spending a decode on it. The converse is not checked and cannot be: a
     `.png` that is not a PNG declares `image/png` quite happily, and what
     catches that is the decoder below refusing it, which is `unreadable`. An
     empty type — some drag sources give one — is not evidence of anything, so
     it goes to the decoder rather than being turned away here. */
  if (file.type !== "" && !file.type.startsWith("image/")) {
    return { ok: false, problem: "not-an-image" };
  }
  if (typeof createImageBitmap !== "function") return { ok: false, problem: "unreadable" };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, problem: "unreadable" };
  }

  try {
    const size = fitWithin(bitmap.width, bitmap.height);
    if (size.width < 1 || size.height < 1) return { ok: false, problem: "unreadable" };

    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return { ok: false, problem: "unreadable" };
    context.drawImage(bitmap, 0, 0, size.width, size.height);

    const blob = await toPng(canvas);
    if (!blob) return { ok: false, problem: "unreadable" };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    /* Refused here rather than posted and 413'd, so the reader is told what to
       do about it while the dialog is still open and their words are still in
       it. The cap is the server's own (src/types.ts) and is on decoded bytes,
       which is what these are — the base64 expansion is the route's own body
       limit's problem. */
    if (bytes.length > MAX_FEEDBACK_SCREENSHOT_BYTES) return { ok: false, problem: "too-big" };

    return {
      ok: true,
      base64: base64(bytes),
      width: size.width,
      height: size.height,
      bytes: bytes.length,
    };
  } catch {
    /* `drawImage` and `toBlob` both throw on a bitmap the engine decoded and
       cannot paint. The same thing to act on as a decode failure. */
    return { ok: false, problem: "unreadable" };
  } finally {
    /* A decoded bitmap holds its raster until it is closed or collected, and a
       reader who pastes four screenshots looking for the right one would
       otherwise be holding four full-size rasters. */
    bitmap.close();
  }
}

/**
 * The first image in a clipboard or a drop, or `null`.
 *
 * `items` first and `files` second, because a paste from the OS screenshot tool
 * arrives as an item and only sometimes as a file, while a drag from a file
 * manager is the other way round. Both are filtered on `image/`: a paste from a
 * document carries a `text/html` item, and a dragged `.txt` is a file item with
 * no picture in it.
 */
function firstImage(data: DataTransfer | null): File | null {
  if (!data) return null;
  if (data.items) {
    for (const item of Array.from(data.items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
  }
  if (data.files) {
    for (const file of Array.from(data.files)) {
      if (file.type.startsWith("image/")) return file;
    }
  }
  return null;
}

/**
 * The image a reader just pasted, if they pasted one.
 *
 * The handler stays in the dialog: whether to `preventDefault` depends on
 * whether this returned anything, and that decision belongs next to the text
 * boxes the paste would otherwise land in.
 */
export function imageFileFromPaste(event: ClipboardEvent): File | null {
  return firstImage(event.clipboardData);
}

/** The image a reader just dropped on the dialog, if they dropped one. */
export function imageFileFromDrop(event: DragEvent): File | null {
  return firstImage(event.dataTransfer);
}
