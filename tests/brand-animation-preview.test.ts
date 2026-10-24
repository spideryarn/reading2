import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { previewLogoAnimation } from "../scripts/preview-logo-animation.js";

const ROOT = path.resolve(import.meta.dirname, "..");
let temporary: string;
let css: string;

beforeAll(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "spideryarn-animation-proof-"));
  css = await readFile(path.join(ROOT, "src/web/styles/logo-animations.css"), "utf8");
});
afterAll(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });

describe("static animation proof command", () => {
  it("rejects a missing proof without creating it", async () => {
    const outputPath = path.join(temporary, "missing.png");
    await expect(previewLogoAnimation({ outputPath, check: true })).rejects.toThrow(/ENOENT/);
    await expect(stat(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects stale bytes without replacing the proof or touching its mtime", async () => {
    const outputPath = path.join(temporary, "stale.png");
    const stale = Buffer.from("deliberately stale proof");
    await writeFile(outputPath, stale);
    await utimes(outputPath, 1_000, 1_000);
    const before = await stat(outputPath);
    await expect(previewLogoAnimation({ outputPath, check: true })).rejects.toThrow(/proof is stale/);
    expect(await readFile(outputPath)).toEqual(stale);
    expect((await stat(outputPath)).mtimeMs).toBe(before.mtimeMs);
  });

  it("generates a fresh proof and checks it without rewriting or changing mtime", async () => {
    const outputPath = path.join(temporary, "fresh.png");
    expect(await previewLogoAnimation({ outputPath })).toBe(outputPath);
    const generated = await readFile(outputPath);
    expect(generated.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    await utimes(outputPath, 1_000, 1_000);
    const before = await stat(outputPath);
    expect(await previewLogoAnimation({ outputPath, check: true })).toBe(outputPath);
    expect(await readFile(outputPath)).toEqual(generated);
    expect((await stat(outputPath)).mtimeMs).toBe(before.mtimeMs);
  });

  it.each([
    ["missing geometry", "", /Missing clip-path/],
    ["unsupported clip geometry", ".spya-semaphore .logo-image { clip-path: circle(50%); }", /Expected a percentage polygon/],
    ["malformed pivot", ".spya-semaphore .logo-mark::before { transform-origin: 10px 20px; }", /Expected two percentage coordinates/],
  ] as const)("refuses %s before creating output", async (name, override, error) => {
    const outputPath = path.join(temporary, `${name.replaceAll(" ", "-")}.png`);
    const cssText = override ? `${css}\n${override}` : "";
    await expect(previewLogoAnimation({ outputPath, cssText })).rejects.toThrow(error);
    await expect(stat(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
