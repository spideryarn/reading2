/**
 * Where `gjd-remote upload` puts a file, and whether the shell that puts it
 * there does what it claims.
 *
 * `uploadDestination` is pure, so it gets table tests. The cases that matter
 * are not the ordinary ones: they are the local paths whose basename is `..` or
 * empty, because `uploads/..` is the checkout itself and an upload that
 * resolved there would write over the repo rather than into a folder beside it.
 *
 * `remoteWriteScript` IS RUN, against real temporary directories, rather than
 * matched against expected text. It is `sh` and its whole value is what `ln`,
 * `mv -fT` and `mkdir -p` actually do in the awkward cases; a test that asserted
 * on the string would only ever agree with whatever we already believed, and the
 * two bugs below (`mv -f` into a directory, and a shared staging path) both got
 * past a reading of the same string. docs/reusable/silent-success.md.
 *
 * The script is written for the box, which is Linux, and `-T` on `ln` and `mv`
 * is GNU coreutils — BSD's, on Greg's Mac, has neither. So the half of this file
 * that RUNS the script is gated on finding a GNU `mv` and `ln`, and `npm test`
 * on the Mac skips it rather than failing for the platform. A skip that could
 * happen by accident would be worse than the failure it avoids, so there is a
 * test below asserting the gate is open whenever we are on Linux.
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  UPLOADS_DIR,
  WRITE_EXISTS_STATUS,
  escapeForDisplay,
  remoteWriteScript,
  stagingPath,
  uploadDestination,
} from "../scripts/gjd-remote-upload.js";

const REPO = "/home/greg/code/spideryarn2";

describe("uploadDestination", () => {
  it("puts a file in uploads/ under the checkout, keeping its name", () => {
    const d = uploadDestination(REPO, "/Users/greg/Desktop/failing-page.png");
    expect(d).toEqual({
      ok: true,
      name: "failing-page.png",
      dir: `${REPO}/${UPLOADS_DIR}`,
      dest: `${REPO}/${UPLOADS_DIR}/failing-page.png`,
    });
  });

  it("takes only the basename, so nested local paths do not become nested remote ones", () => {
    const d = uploadDestination(REPO, "/a/b/c/notes.md");
    expect(d.ok && d.dest).toBe(`${REPO}/${UPLOADS_DIR}/notes.md`);
  });

  it("allows a dotfile — this guards where the write goes, not what is in it", () => {
    const d = uploadDestination(REPO, "/tmp/.env.example");
    expect(d.ok && d.name).toBe(".env.example");
  });

  it("allows the characters shq handles: spaces, quotes, dollars, globs", () => {
    const d = uploadDestination(REPO, "/tmp/a file 'x' $y *.png");
    expect(d.ok && d.name).toBe("a file 'x' $y *.png");
  });

  it("tolerates a trailing slash on the checkout rather than doubling it", () => {
    const d = uploadDestination(`${REPO}/`, "/tmp/x.txt");
    expect(d.ok && d.dest).toBe(`${REPO}/${UPLOADS_DIR}/x.txt`);
  });

  // The whole reason the function exists. Each of these has a basename that
  // would escape uploads/ or name nothing at all.
  it.each([
    ["a bare dot-dot", "/tmp/.."],
    ["a path ending in ..", "/a/b/.."],
    ["the root", "/"],
    ["a bare dot", "."],
  ])("refuses %s", (_what, given) => {
    const d = uploadDestination(REPO, given);
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.why).toMatch(/does not name a file/);
  });

  // `path.basename("/a/b/")` is `b`, so a trailing slash is not a refusal here
  // and should not be: the caller has already refused a directory by `statSync`
  // before this is reached, and duplicating that check in two places is how the
  // two of them come to disagree.
  it("reads a trailing slash as naming the last segment", () => {
    const d = uploadDestination(REPO, "/a/b/");
    expect(d.ok && d.name).toBe("b");
  });

  // Not about the shell — `shq` handles quoting. The name is printed back on
  // success, and an ESC in it can forge the line after it.
  it.each([
    ["an escape", "/tmp/we\x1b[2Kird.txt"],
    ["a newline", "/tmp/we\nird.txt"],
    ["a NUL", "/tmp/we\x00ird.txt"],
    ["a backspace", "/tmp/weird.txt\x08\x08\x08png"],
  ])("refuses a name carrying %s", (_what, given) => {
    const d = uploadDestination(REPO, given);
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.why).toMatch(/control character/);
  });

  it("shows a refused name with its control characters escaped, not raw", () => {
    const d = uploadDestination(REPO, "/tmp/a\x1bb");
    expect(d.ok === false && d.why).toContain("a\\x1bb");
    expect(d.ok === false && d.why).not.toContain("\x1b");
  });

  it("refuses a relative box directory — the destination is always absolute", () => {
    const d = uploadDestination("code/spideryarn2", "/tmp/x.txt");
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.why).toMatch(/absolute path/);
  });
});

describe("escapeForDisplay", () => {
  it("leaves ordinary text alone", () => {
    expect(escapeForDisplay("a file 'x'.png")).toBe("a file 'x'.png");
  });

  it("names each control character by its code", () => {
    expect(escapeForDisplay("a\x1b\x00\x7f")).toBe("a\\x1b\\x00\\x7f");
  });
});

// --------------------------------------------------------- the remote script

let box: string;

beforeAll(() => {
  box = mkdtempSync(join(tmpdir(), "gjd-write-"));
});
afterAll(() => {
  rmSync(box, { recursive: true, force: true });
});

/** Does this machine's `ln` and `mv` understand `-T`? The box's does; BSD's does
 *  not, and that difference is the whole reason the gate exists. */
function hasGnuCoreutils(): boolean {
  return ["mv", "ln"].every((tool) => {
    const r = spawnSync(tool, ["--help"], { encoding: "utf8" });
    return `${r.stdout ?? ""}${r.stderr ?? ""}`.includes("--no-target-directory");
  });
}
const GNU = hasGnuCoreutils();
const onGnu = GNU ? describe : describe.skip;

// The gate must never close by accident. The box and CI are Linux, and there
// the behavioural suite below is not optional — a silent skip would be exactly
// the check that has never been seen to fail.
it("runs the behavioural suite wherever GNU coreutils are, which includes Linux", () => {
  if (process.platform === "linux") expect(GNU).toBe(true);
});

/** Run the generated script the way ssh does — with the bytes on stdin — and
 *  hand back where it would have staged them, so a test can check it is gone.
 *  A fresh id each time, as writeRemote mints one per invocation. */
let n = 0;
function run(
  dest: string,
  content: string,
  opts: { exec?: boolean; clobber?: boolean; bytes?: number } = {},
): { status: number | null; part: string; stderr: string } {
  const partId = `${++n}-0000-0000`;
  const script = remoteWriteScript({
    dest,
    partId,
    bytes: opts.bytes ?? Buffer.byteLength(content),
    exec: opts.exec === true,
    clobber: opts.clobber !== false,
  });
  const r = spawnSync("sh", ["-c", script], { input: content, encoding: "utf8" });
  return { status: r.status, part: stagingPath(dest, partId), stderr: r.stderr ?? "" };
}

onGnu("remoteWriteScript", () => {
  it("makes the parent directory and writes the bytes", () => {
    const dest = join(box, "made/up/deep/file.txt");
    const { status, part } = run(dest, "hello");
    expect(status).toBe(0);
    expect(readFileSync(dest, "utf8")).toBe("hello");
    expect(existsSync(part)).toBe(false);
  });

  it("writes 0600, because an upload may well be a credential dump", () => {
    const dest = join(box, "modes/secret.env");
    expect(run(dest, "K=v").status).toBe(0);
    expect(lstatSync(dest).mode & 0o777).toBe(0o600);
    expect(lstatSync(join(box, "modes")).mode & 0o777).toBe(0o700);
  });

  it("adds the executable bit when asked, and only then", () => {
    const a = join(box, "modes/job.sh");
    expect(run(a, "#!/bin/sh\n", { exec: true }).status).toBe(0);
    expect(lstatSync(a).mode & 0o100).toBe(0o100);
    const b = join(box, "modes/plain.sh");
    expect(run(b, "#!/bin/sh\n").status).toBe(0);
    expect(lstatSync(b).mode & 0o100).toBe(0);
  });

  // The failure this whole recipe exists for: `cat > f` exits 0 on a stdin that
  // ended early, so the size the box counted is the only thing that catches it.
  it("refuses, and leaves nothing behind, when fewer bytes arrive than promised", () => {
    const dest = join(box, "short/truncated.txt");
    const { status, part } = run(dest, "only this much", { bytes: 9999 });
    expect(status).not.toBe(0);
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(part)).toBe(false);
  });

  it("replaces an existing file when it may clobber", () => {
    const dest = join(box, "clobber/x.txt");
    expect(run(dest, "first").status).toBe(0);
    expect(run(dest, "second").status).toBe(0);
    expect(readFileSync(dest, "utf8")).toBe("second");
  });

  // GPT Sol's finding 2, reproduced: plain `mv -f` moves the staging file INTO
  // a directory sitting at the destination and exits 0, so the tool reports a
  // path it never wrote. `-T` is what refuses.
  it("refuses to publish over a DIRECTORY at the destination rather than moving into it", () => {
    const dest = join(box, "clobber/adir");
    mkdirSync(dest, { recursive: true });
    const { status, part } = run(dest, "bytes");
    expect(status).not.toBe(0);
    expect(lstatSync(dest).isDirectory()).toBe(true);
    expect(existsSync(join(dest, "bytes"))).toBe(false);
    expect(existsSync(part)).toBe(false);
  });

  it("refuses when the parent is a symlink, however inviting mkdir -p was about it", () => {
    const elsewhere = join(box, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    const link = join(box, "linked");
    symlinkSync(elsewhere, link);
    const { status, part } = run(join(link, "x.txt"), "bytes");
    expect(status).not.toBe(0);
    expect(existsSync(join(elsewhere, "x.txt"))).toBe(false);
    expect(existsSync(part)).toBe(false);
  });

  describe("with clobber: false", () => {
    it("writes when nothing is there", () => {
      const dest = join(box, "noclobber/new.txt");
      expect(run(dest, "mine", { clobber: false }).status).toBe(0);
      expect(readFileSync(dest, "utf8")).toBe("mine");
    });

    it("reports EXISTS and leaves the original untouched", () => {
      const dest = join(box, "noclobber/taken.txt");
      writeFileSync(dest, "theirs");
      const { status, part } = run(dest, "mine", { clobber: false });
      expect(status).toBe(WRITE_EXISTS_STATUS);
      expect(readFileSync(dest, "utf8")).toBe("theirs");
      expect(existsSync(part)).toBe(false);
    });

    // `ln`'s stderr used to go to /dev/null, which turned every OTHER reason a
    // link can fail — a read-only mount, a permissions problem — into the
    // caller's "bytes did not arrive intact", a complaint about the one thing
    // that had just been checked and was fine. Sol's second review, finding 3.
    // Seeing the message here is the proof it is no longer discarded; on this
    // path the caller does not print it, because 17 has its own sentence.
    it("does not swallow what ln said when it refused", () => {
      const dest = join(box, "noclobber/noisy.txt");
      writeFileSync(dest, "theirs");
      const { status, stderr } = run(dest, "mine", { clobber: false });
      expect(status).toBe(WRITE_EXISTS_STATUS);
      expect(stderr).toMatch(/ln:/);
    });

    // `[ -e ]` is FALSE for a dangling symlink, which is why the guard is `ln`
    // and not a test. Sol's finding 3.
    it("reports EXISTS for a dangling symlink, which a -e probe would have missed", () => {
      const dest = join(box, "noclobber/dangling.txt");
      symlinkSync(join(box, "nothing-here"), dest);
      expect(run(dest, "mine", { clobber: false }).status).toBe(WRITE_EXISTS_STATUS);
      expect(lstatSync(dest).isSymbolicLink()).toBe(true);
      expect(existsSync(join(box, "nothing-here"))).toBe(false);
    });

    it("reports EXISTS for a directory too, rather than writing inside it", () => {
      const dest = join(box, "noclobber/adir");
      mkdirSync(dest, { recursive: true });
      expect(run(dest, "mine", { clobber: false }).status).toBe(WRITE_EXISTS_STATUS);
      expect(lstatSync(dest).isDirectory()).toBe(true);
    });

    // NOT a race test — these run one after the other, and the atomicity is
    // `link(2)`'s rather than anything a unit test here could demonstrate. What
    // it pins is the collision rule: the second writer is told the name was
    // taken, and the first writer's bytes are what remain.
    it("lets only the first of two writers claim the name", () => {
      const dest = join(box, "noclobber/collision.txt");
      const first = run(dest, "aaaa", { clobber: false });
      const second = run(dest, "bbbb", { clobber: false });
      expect([first.status, second.status]).toEqual([0, WRITE_EXISTS_STATUS]);
      expect(readFileSync(dest, "utf8")).toBe("aaaa");
    });
  });

  it("survives a name full of shell metacharacters", () => {
    const dest = join(box, "quoting/it's $HOME `x` *.txt");
    expect(run(dest, "quoted").status).toBe(0);
    expect(readFileSync(dest, "utf8")).toBe("quoted");
  });

  it("keeps two writers to one destination on separate staging files", () => {
    const dest = join(box, "staging/x.txt");
    const spec = { dest, bytes: 1, exec: false, clobber: true } as const;
    expect(remoteWriteScript({ ...spec, partId: "a" })).not.toBe(remoteWriteScript({ ...spec, partId: "b" }));
  });
});

// Pure, so it is checked on every machine. The gate above only covers RUNNING
// the script, and this is the naming rule the whole staging story rests on.
describe("stagingPath", () => {
  it("sits beside the destination, under a name the id decides", () => {
    expect(stagingPath("/a/b/shot.png", "9f3a")).toBe("/a/b/shot.png.9f3a.part");
  });

  // The bug this replaced: `<dest>.part` is guessable, so it is plantable as a
  // symlink and shared by two writers at once. Sol's finding 1.
  it("is never the guessable <dest>.part", () => {
    expect(stagingPath("/a/b/shot.png", "9f3a")).not.toBe("/a/b/shot.png.part");
  });

  it("gives different ids different files", () => {
    expect(stagingPath("/a/b/x", "one")).not.toBe(stagingPath("/a/b/x", "two"));
  });
});
