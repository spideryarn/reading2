/**
 * Putting a file on the box: where `gjd-remote upload` sends it, and the shell
 * that lands it there.
 *
 * Split out for the reason every other `gjd-remote-*.ts` is split out:
 * [`scripts/gjd-remote.ts`](gjd-remote.ts) calls `main()` on import, so nothing
 * that lives in it can be tested. Both halves here are worth testing and neither
 * could be where it was — `remoteWriteScript` is real `sh`, so
 * [`tests/gjd-remote-upload.test.ts`](../tests/gjd-remote-upload.test.ts) runs it
 * against temporary directories rather than asserting on its text.
 *
 * `remoteWriteScript` is the recipe behind EVERY `writeRemote` call, not just
 * `upload` — prompts, job scripts and the staged `provision.sh` all go through
 * it. One recipe, because two of these would be two atomic-write recipes and the
 * one that got a fix would not be the one somebody was running.
 *
 * See docs/project/hetzner-remote-server-box.md § Getting a file onto the box.
 */
import path from "node:path";

/** The folder, under the repo's checkout on the box. Named once, because the
 *  command, the help text and the doc must all mean the same directory. */
export const UPLOADS_DIR = "uploads";

/**
 * The exit status the script uses for "something is already at the destination
 * and I was told not to replace it".
 *
 * A status rather than a word on stdout: the caller is `ssh`, which hands back
 * the remote status verbatim, and a number cannot be confused with output that
 * happened to contain the word. 17 is `EEXIST` and collides with nothing a
 * shell produces on its own (1, 2, 126, 127) nor with ssh's own 255.
 */
export const WRITE_EXISTS_STATUS = 17;

export type UploadDestination = { ok: true; name: string; dir: string; dest: string } | { ok: false; why: string };

/**
 * `<repo checkout>/uploads/<basename>`, or a refusal.
 *
 * THE BASENAME IS CHECKED RATHER THAN TRUSTED, and that is the whole of this
 * function. `path.basename` answers `..` for `../`, `..` for `a/..`, and the
 * empty string for `/` — and `uploads/..` is the checkout itself, so any of
 * those turns "put this file in uploads" into a write over the repo. The caller
 * refuses a directory before it gets here, which makes those cases hard to
 * reach through the CLI; they are checked anyway, because this function is the
 * one place that decides a remote path and it should not depend on a check
 * somewhere else staying where it is.
 *
 * CONTROL CHARACTERS ARE REFUSED, and not because of the shell — the caller
 * quotes the path, and a name with a space, a quote, a `$` or a glob character
 * in it goes through fine. It is the terminal: the name is printed back on
 * success, and a name carrying an ESC can forge whatever it likes on the line
 * after it, up to and including a plausible `✓` for a file that went elsewhere.
 *
 * A hidden name (`.env.local`) is a fine thing to upload and is allowed. This
 * is not an allowlist of file types; it is a guard on where the write goes and
 * on what gets printed afterwards.
 */
export function uploadDestination(repoDir: string, localPath: string): UploadDestination {
  if (!repoDir.startsWith("/")) return { ok: false, why: `'${repoDir}' is not an absolute path on the box` };
  const name = path.basename(localPath);
  if (name === "" || name === "." || name === "..") {
    return { ok: false, why: `'${localPath}' does not name a file — I would have nothing to call it on the box` };
  }
  if (name.includes("/") || name.includes("\\")) {
    return { ok: false, why: `'${name}' is not a filename I will write on the box` };
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
  if (/[\x00-\x1f\x7f]/.test(name)) {
    return { ok: false, why: `'${escapeForDisplay(name)}' has a control character in it, and I will not print that back at you` };
  }
  const dir = path.posix.join(repoDir, UPLOADS_DIR);
  return { ok: true, name, dir, dest: path.posix.join(dir, name) };
}

/** Control characters as `\x1b`, for a refusal that has to name the thing it is
 *  refusing without doing what the name asked. */
export function escapeForDisplay(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: same reason
  return s.replaceAll(/[\x00-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

/**
 * Where the bytes wait while they are being checked.
 *
 * The `id` is a uuid the caller mints per invocation, and the naming lives HERE
 * rather than at the call site so that the guarantee is inside the thing the
 * tests exercise. A predictable `<dest>.part` is a symlink somebody else can
 * plant — `cat >` follows one and writes wherever it points, which for the
 * `provision.sh` staged under world-writable `/tmp` is the whole box. It is
 * also the concurrency bug: two uploads of `screenshot.png` at once shared one
 * staging file, and with equal sizes each could have published the other's
 * bytes under a green tick. GPT Sol's finding 1.
 */
export function stagingPath(dest: string, id: string): string {
  return `${dest}.${id}.part`;
}

export type RemoteWriteSpec = {
  /** Where the bytes must end up. */
  dest: string;
  /** A value unique to this invocation — see `stagingPath`. */
  partId: string;
  /** How many bytes the box must find staged before anything is published. */
  bytes: number;
  /** `chmod +x` before publishing, for a job script. */
  exec: boolean;
  /** Replace a file already at `dest`, or exit `WRITE_EXISTS_STATUS`. */
  clobber: boolean;
};

/**
 * One `sh` command that stages bytes from stdin and publishes them, or leaves
 * nothing behind.
 *
 * Every step is a way this has gone, or could go, wrong:
 *
 *  UNIQUE STAGING   see `stagingPath` above.
 *  REAL DIRECTORY   `mkdir -p` is happy for the parent to be a symlink to
 *                   somewhere else entirely, so it is asked afterwards whether
 *                   what it has is a directory and not a link. An `uploads`
 *                   symlink would otherwise redirect every upload out of the
 *                   checkout, silently.
 *  UMASK 077        the file is readable by nobody else. The doc's own reason
 *                   for verifying which repo an upload belongs to is that it may
 *                   well be a credential dump, and `cat >` makes 0644 by
 *                   default. Sol's finding 5.
 *  BYTE COUNT       `cat > f` exits 0 on a stdin that ended early, so a
 *                   connection that dies mid-write leaves a TRUNCATED file that
 *                   still parses and still starts a session. Comparing the size
 *                   on the box costs nothing inside the same command, and turns
 *                   a silent half-write into a refusal.
 *  ATOMIC PUBLISH   `ln -T` when we must not clobber: it fails if ANY name is
 *                   already there, a dangling symlink included, and it fails
 *                   inside the kernel rather than between two of our round
 *                   trips — so "never replaces a file" holds against another
 *                   agent creating it a millisecond ago. `mv -fT` when we may.
 *                   The `-T` is on both and is not decoration: given a DIRECTORY
 *                   at the destination, plain `ln` and plain `mv` each put the
 *                   file INSIDE it and exit 0, leaving the tool reporting a path
 *                   it never wrote. Sol reproduced that for `mv`; the test for
 *                   the `ln` half of it found the same bug here.
 *
 * Nothing is left at `dest` unless every step agreed, and the staging file is
 * removed on the way out of every branch — by the script itself, because the
 * dropped connection that leaves it behind is the case where a caller's second
 * round trip to tidy up does not happen either.
 */
export function remoteWriteScript(s: RemoteWriteSpec): string {
  const dir = path.posix.dirname(s.dest);
  const part = shq(stagingPath(s.dest, s.partId));
  const dest = shq(s.dest);
  // `-T` on BOTH. `ln src dir` and `mv src dir` both mean "put it INSIDE dir"
  // when a directory is sitting at the destination — they succeed, exit 0, and
  // leave the tool reporting a path it never wrote. `-T` says the destination
  // is the name, not a place to put things, and refuses. GNU coreutils only,
  // which the box is.
  const publish = s.clobber
    ? `mv -fT ${part} ${dest}`
    : // `[ -e ] || [ -L ]` is what separates "it is already there" — which is
      // the one outcome the caller offers a `--force` for — from a link that
      // failed for some other reason, a full disk or a read-only mount. `-L`
      // because `-e` is FALSE for a dangling symlink, and a dangling symlink is
      // still a name in the way.
      //
      // `ln`'s stderr is NOT thrown away. It used to be, and that turned a
      // read-only mount or a permissions problem into "bytes did not arrive
      // intact" — a message about the one thing that had just been checked and
      // was fine. Sol's second review, finding 3. On the `exit 17` path the
      // caller never prints stderr, so nothing noisy reaches the ordinary case.
      //
      // `rm -f || exit 1` rather than ignoring the removal: 17 is a promise
      // that nothing was left behind, and a cleanup that failed makes it a lie.
      // Ordinary failure instead, which sends the caller down its own cleanup
      // path. Sol's finding 4.
      `if ln -T ${part} ${dest}; then rm -f ${part}; ` +
      `else rm -f ${part} || exit 1; ` +
      `if [ -e ${dest} ] || [ -L ${dest} ]; then exit ${WRITE_EXISTS_STATUS}; fi; ` +
      `exit 1; fi`;
  const chain = [
    `mkdir -p ${shq(dir)}`,
    `[ ! -L ${shq(dir)} ]`,
    `[ -d ${shq(dir)} ]`,
    `cat > ${part}`,
    `[ "$(wc -c < ${part})" -eq ${s.bytes} ]`,
    ...(s.exec ? [`chmod +x ${part}`] : []),
    publish,
  ].join(" && ");
  // The staging file is cleaned up BY THE SCRIPT, in one place, whichever step
  // failed. It used to be left for the caller to remove over a second ssh — and
  // the connection that dropped mid-write is exactly the case where that second
  // round trip does not happen, so the litter was worst where it mattered most.
  // The `exit 17` branch above has already removed it and exits before here.
  return `umask 077; { ${chain} ; }; s=$?; [ "$s" -eq 0 ] || rm -f ${part}; exit "$s"`;
}

/** Single-quoted for `sh`, the same recipe as every other module here that
 *  builds a remote command. */
function shq(v: string): string {
  return `'${v.replaceAll("'", `'\\''`)}'`;
}
