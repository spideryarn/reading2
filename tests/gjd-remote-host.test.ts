/**
 * Which address `gjd-remote` sends its ssh to.
 *
 * These exist because of a failure that looked like a missing feature: on the
 * box, `GJD_REMOTE_HOST` is exported from /etc/profile.d/, which only a LOGIN
 * shell reads, and every agent tool shell is not one. The tool then fell
 * through to Terraform state, which the box has not got, and died saying
 * "could not read the server address from Terraform state" — so two separate
 * readers concluded the tool could not run on the box at all, and one of them
 * wrote that into the docs.
 *
 * The rule these hold: **only ENOENT means the file is absent.** Anything else
 * — a permission error, a directory, a symlink, an empty file, two lines, a
 * value that is not a bare host token — is a loud failure naming the path. A
 * broad catch would turn a bad line in /etc into an error message about
 * Terraform, which is the same wrong-diagnosis bug one layer down.
 *
 * See docs/plans/260905d-gjd-remote-resolves-the-box-address-without-an-env-var.md
 * and docs/reusable/silent-success.md.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  BOX_HOST_FILE,
  type BoxHostRead,
  describeSource,
  readBoxHostFile,
  resolveHost,
} from "../scripts/gjd-remote-host.js";

const TMP = mkdtempSync(path.join(tmpdir(), "gjd-remote-host-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** A file with these bytes in it, and its path. */
function fileWith(name: string, contents: string): string {
  const p = path.join(TMP, name);
  writeFileSync(p, contents);
  return p;
}

const absent = (): BoxHostRead => ({ kind: "absent" });
const found = (host: string) => (): BoxHostRead => ({ kind: "found", host });
const bad = (why: string) => (): BoxHostRead => ({ kind: "bad", why });
const noTerraform = () => ({ ok: false as const, why: "no tofu here" });
const terraformSays = (host: string) => () => ({ ok: true as const, host });

describe("resolveHost — the order of the three sources", () => {
  it("takes GJD_REMOTE_HOST first, and does not read anything else", () => {
    let boxFileRead = 0;
    let terraformRun = 0;
    const answer = resolveHost({
      env: { GJD_REMOTE_HOST: "10.0.0.9" },
      boxFile: () => {
        boxFileRead += 1;
        return found("127.0.0.1")();
      },
      terraform: () => {
        terraformRun += 1;
        return terraformSays("1.2.3.4")();
      },
    });
    expect(answer).toEqual({ ok: true, host: "10.0.0.9", source: "env" });
    // Not a nicety: `tofu output` is a subprocess, and host() is called on
    // every ssh, scp and mosh.
    expect([boxFileRead, terraformRun]).toEqual([0, 0]);
  });

  it("takes the box file when the variable is unset, without running Terraform", () => {
    let terraformRun = 0;
    const answer = resolveHost({
      env: {},
      boxFile: found("127.0.0.1"),
      terraform: () => {
        terraformRun += 1;
        return terraformSays("1.2.3.4")();
      },
    });
    // The box's Terraform answer would be its PUBLIC address, and ssh to that
    // from the box is `Permission denied (publickey)` — the loopback key is
    // offered only for `Host 127.0.0.1` under IdentitiesOnly. Measured
    // 2026-09-05 against 188.245.166.213.
    expect(answer).toEqual({ ok: true, host: "127.0.0.1", source: "box-file" });
    expect(terraformRun).toBe(0);
  });

  it("falls through to Terraform when there is no file — the laptop, unchanged", () => {
    expect(resolveHost({ env: {}, boxFile: absent, terraform: terraformSays("1.2.3.4") })).toEqual({
      ok: true,
      host: "1.2.3.4",
      source: "terraform",
    });
  });

  it("reports Terraform's own failure when nothing answers", () => {
    const answer = resolveHost({ env: {}, boxFile: absent, terraform: noTerraform });
    expect(answer.ok).toBe(false);
    expect(answer.ok === false && answer.why).toContain("no tofu here");
  });

  it("a bad file is a failure, never a fall-through to Terraform", () => {
    // The whole point. If a malformed /etc/gjd-remote-host quietly became
    // "absent", the machine whose /etc is wrong would report a Terraform
    // problem — the exact wrong-diagnosis this change exists to end.
    let terraformRun = 0;
    const answer = resolveHost({
      env: {},
      boxFile: bad("/etc/gjd-remote-host: holds 2 lines, wanted one address"),
      terraform: () => {
        terraformRun += 1;
        return terraformSays("1.2.3.4")();
      },
    });
    expect(answer.ok).toBe(false);
    expect(answer.ok === false && answer.why).toContain("/etc/gjd-remote-host");
    // Counted, not inferred from the return value: an implementation that ran
    // Terraform first and returned the file's error afterwards would satisfy
    // every other assertion here.
    expect(terraformRun).toBe(0);
  });

  it("an empty string in the variable is not an answer", () => {
    // `env GJD_REMOTE_HOST= gjd-remote ls` is somebody clearing it, not
    // somebody asking for the empty host.
    expect(resolveHost({ env: { GJD_REMOTE_HOST: "" }, boxFile: absent, terraform: terraformSays("1.2.3.4") })).toEqual(
      { ok: true, host: "1.2.3.4", source: "terraform" },
    );
  });
});

describe("readBoxHostFile — what counts as absent, and what counts as broken", () => {
  it("only ENOENT is absent", () => {
    expect(readBoxHostFile(path.join(TMP, "nothing-here"))).toEqual({ kind: "absent" });
  });

  it("takes a bare address, with or without a trailing newline", () => {
    expect(readBoxHostFile(fileWith("plain", "127.0.0.1"))).toEqual({ kind: "found", host: "127.0.0.1" });
    expect(readBoxHostFile(fileWith("newline", "127.0.0.1\n"))).toEqual({ kind: "found", host: "127.0.0.1" });
  });

  it("refuses an empty file, and says which file", () => {
    const r = readBoxHostFile(fileWith("empty", ""));
    expect(r.kind).toBe("bad");
    expect(r.kind === "bad" && r.why).toContain("empty");
    expect(r.kind === "bad" && r.why).toContain(path.join(TMP, "empty"));
  });

  it("refuses a second line, even a comment", () => {
    // A file whose first line is right and second line is anything is a file
    // somebody edited by hand, and the next question is which line won.
    expect(readBoxHostFile(fileWith("two-lines", "127.0.0.1\n1.2.3.4\n")).kind).toBe("bad");
    expect(readBoxHostFile(fileWith("comment", "# the box\n127.0.0.1\n")).kind).toBe("bad");
  });

  it("refuses stray whitespace rather than trimming it", () => {
    expect(readBoxHostFile(fileWith("spaced", " 127.0.0.1\n")).kind).toBe("bad");
    expect(readBoxHostFile(fileWith("trailing", "127.0.0.1 \n")).kind).toBe("bad");
  });

  it("refuses anything that is not a bare host token", () => {
    for (const [name, contents] of [
      ["two-words", "127.0.0.1 extra"],
      ["option", "-oProxyCommand=touch /tmp/pwned"],
      ["semicolon", "127.0.0.1; rm -rf /"],
      ["quote", "127.0.0.1'"],
      ["url", "ssh://127.0.0.1"],
    ] as const) {
      const r = readBoxHostFile(fileWith(name, contents));
      expect(r.kind, `${name} should be refused`).toBe("bad");
    }
  });

  it("accepts a hostname as well as an IP", () => {
    // The file says which address to use on THIS machine; nothing about it is
    // specific to a loopback IP, and a box behind a name is not a bug.
    expect(readBoxHostFile(fileWith("name", "spideryarn-box\n"))).toEqual({ kind: "found", host: "spideryarn-box" });
  });

  it("refuses anything with a colon in it — ssh and scp do not read those alike", () => {
    // Measured 2026-09-05 against a fake ssh: scp handed `greg@2001:db8::1:/tmp/x`
    // on as host `2001`, while `ssh -G greg@2001:db8::1` used the whole address.
    // A file that both tools accept and disagree about is a file that sends the
    // upload to a different machine than the session — with the tool printing
    // the address only one of them used. So: no IPv6, and no host:port either.
    for (const value of ["2001:db8::1", "::1", "host:2222", "a:b"]) {
      const r = readBoxHostFile(fileWith(`colon-${value.replaceAll(":", "-")}`, `${value}\n`));
      expect(r.kind, `${value} should be refused`).toBe("bad");
    }
  });

  it("refuses a directory rather than reporting it absent", () => {
    const dir = path.join(TMP, "a-directory");
    mkdirSync(dir, { recursive: true });
    const r = readBoxHostFile(dir);
    expect(r.kind).toBe("bad");
    expect(r.kind === "bad" && r.why).toContain(dir);
  });

  it("refuses a symlink, however innocent its target", () => {
    // The address decides which machine every later command talks to, so the
    // file that holds it is not a thing to reach through a redirection nobody
    // can see in `cat`.
    const target = fileWith("symlink-target", "127.0.0.1\n");
    const link = path.join(TMP, "a-symlink");
    symlinkSync(target, link);
    const r = readBoxHostFile(link);
    expect(r.kind).toBe("bad");
    expect(r.kind === "bad" && r.why).toContain("symlink");
  });

  it("refuses an unreadable file rather than calling it absent", () => {
    const p = fileWith("unreadable", "127.0.0.1\n");
    chmodSync(p, 0o000);
    const r = readBoxHostFile(p);
    // Running as root would read it anyway, and then this proves nothing —
    // say so rather than passing quietly.
    if (process.getuid?.() === 0) {
      expect(r.kind).toBe("found");
      return;
    }
    expect(r.kind).toBe("bad");
    expect(r.kind === "bad" && r.why).toContain("EACCES");
  });
});

describe("describeSource — what doctor and resolve print", () => {
  it("names the file when the file answered, so the reader can go and look at it", () => {
    expect(describeSource("box-file")).toContain(BOX_HOST_FILE);
  });

  it("names the other two without pretending they are files", () => {
    expect(describeSource("env")).toContain("GJD_REMOTE_HOST");
    expect(describeSource("terraform")).toContain("Terraform");
  });
});
