/** The reusable Help GIF maker: input order and its two fail-closed checks. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";

import { gifFrameBlocks } from "./helpers/image-size.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "frames-to-gif.ts");
const scratch: string[] = [];

function frame(dir: string, name: string, width: number, height: number, colour: string): void {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, width, height);
  writeFileSync(path.join(dir, name), canvas.toBuffer("image/png"));
}

function run(dir: string) {
  const out = path.join(dir, "out.gif");
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", SCRIPT, dir, out, "--delay", "20", "--hold-first", "20", "--hold-last", "20", "--colours", "2"],
    { cwd: ROOT, encoding: "utf8", timeout: 15_000 },
  );
  return { ...child, out };
}

function dir(): string {
  const made = mkdtempSync(path.join(tmpdir(), "frames-to-gif-test-"));
  scratch.push(made);
  return made;
}

afterEach(() => {
  for (const made of scratch.splice(0)) rmSync(made, { recursive: true, force: true });
});

describe("frames-to-gif", () => {
  it("sorts frame names before encoding them", async () => {
    const frames = dir();
    frame(frames, "0002.png", 4, 3, "#0000ff");
    frame(frames, "0001.png", 4, 3, "#ff0000");

    const made = run(frames);
    expect(made.status, made.stderr).toBe(0);
    expect(gifFrameBlocks(readFileSync(made.out))).toHaveLength(2);
    const image = await loadImage(readFileSync(made.out));
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const pixel = ctx.getImageData(0, 0, 1, 1).data;
    expect(pixel[0]).toBeGreaterThan(200);
    expect(pixel[2]).toBeLessThan(50);
  });

  it("refuses frames with different dimensions", () => {
    const frames = dir();
    frame(frames, "0001.png", 4, 3, "#ff0000");
    frame(frames, "0002.png", 5, 3, "#0000ff");
    const made = run(frames);
    expect(made.status).toBe(1);
    expect(`${made.stdout}${made.stderr}`).toContain("Every frame must be the same size");
  });

  it("refuses a clip whose frames are all the same picture", () => {
    const frames = dir();
    frame(frames, "0001.png", 4, 3, "#ff0000");
    frame(frames, "0002.png", 4, 3, "#ff0000");
    const made = run(frames);
    expect(made.status).toBe(1);
    expect(`${made.stdout}${made.stderr}`).toContain("every frame is the same picture");
  });
});
