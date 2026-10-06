# A resolved path is not a socket identity

The code review of `24c9ed141` found that the fleet collector could refuse a correct default
socket reading. The reported live service check passed; the counterexamples below were found
without contacting tmux. No affected operator was observed, and this review does not establish
whether the candidate was deployed. The affected check lives in
[collect.ts](../../tools/fleet/collect.ts), and the deployment evidence belongs to
[the stage plan](../plans/261006h-fleet-selfcheck-gets-an-anchor-that-works-under-systemd.md).

## What happened

`tmuxSocketPath` takes the first matching line from an unescaped, newline-separated listing.
A pathname may itself contain a newline. With a temporary directory called
`base\ncontinuation`, the genuine fifth-field bytes would be:

```text
$1 %10 100 1234 /tmp/<scratch>/base
continuation/tmux-1000/default
```

The parser returns `/tmp/<scratch>/base`. In a filesystem-only reproduction on 2026-10-06,
that prefix existed as a directory and the full expected path existed as a scratch file.
Both `realpath` calls succeeded. Calling the committed `tmuxSocketPath` and `selfCheck` produced
`kind: "absent"` rather than an unverifiable verdict, naming the prefix and the full expected
path. `collect` throws on that verdict and the dashboard retains stale rows. The scratch file
was deliberately not a tmux socket: the reproduction establishes the parsing and refusal
mechanism, without claiming a live tmux experiment.

The first repair validated every apparent record and required agreeing socket fields. A
follow-up review found that a continuation can itself look like a valid pane row reporting the
same prefix. That repair still refused incorrectly in a red regression. The completed repair
also returns `cannot-check` when the computed or canonical expected path contains a newline;
checking the canonical path covers a normal-looking symlink to such a directory.

A second filesystem-only experiment created a socket-mode node with `mknod`, then hardlinked
it under another name. Both paths had the same device and inode while their `realpath` strings
differed. Therefore canonical pathname inequality alone does not establish socket inequality.
A server started under a named path and reached through a hardlink at the default path is a
reasoned live counterexample; opening a Unix listener was blocked by this sandbox (`EPERM`),
so the connection was not observed here.

## The class: resolving a representation does not authenticate its identity

The check promoted two facts into stronger evidence than they supplied: a successfully parsed
prefix became a complete pathname, and a successfully resolved pathname became a unique socket
identity. The failure handling covered missing paths, but both counterexamples resolve
successfully. An error boundary cannot help when incomplete evidence looks valid.

The introducing commit is `24c9ed141`, confirmed by blame on both `tmuxSocketPath` and
`socketAnchor`. Its intent was to make a previously inert systemd check useful while degrading
filesystem failures to `cannot-check`. The new refusal depends on more than successful
filesystem resolution.

## Why the original tests agreed

The socket tests supplied complete single-line path strings and equated unique resolved names
with unique endpoints. They covered spaces, symlink aliases, missing paths and genuine textual
mismatches. None challenged the record separator or represented one filesystem object with
two canonical names. The service-environment live result validates that deployment's ordinary
path; it does not close either class.

## What would have caught it, ranked by ease against value

1. **Exercise evidence that is valid but ambiguous.** Add regressions for a newline-fractured
   record whose prefix exists, and distinct paths with the same filesystem identity. These need
   no tmux server and distinguish failed resolution from insufficient evidence. The reviewer saw
   these regressions fail before fixing the parser and comparing device/inode for unequal names.
2. **Refuse only after establishing the identity difference.** Degrade ambiguous framing or
   unavailable identity checks to `cannot-check`; compare device and inode when canonical names
   differ. Preserve the existing refusal for two demonstrably different endpoints.
3. **Encode the pathname field on the producer side.** This is the long-term boundary fix if the
   collector must support every Unix pathname. Rejected for this narrow review: it introduces a
   quoting/decoding contract across tmux versions when rejecting ambiguous framing can safely
   retain the existing wire format.
4. **Join the answering server to its open socket through `/proc`.** Rejected here: Linux-only
   machinery exceeds this stage's socket-path anchor and still needs correctly framed inputs.

The narrow fix makes uncertainty explicit before it reaches the blocking verdict. The
long-term contract is an intact pathname plus socket identity, not merely two strings that
`realpath` accepts.

There is still a reasoned concurrency limit: path resolution and inode comparison happen after
the tmux reply, and pathname replacement between those operations is not an observed child
socket identity. No such race was exercised here. Binding the answering server to its open
socket would be a wider change than this stage's reported-path anchor.

---

Up: [postmortems.md](../project/postmortems.md)
