/**
 * Which iTerm2 tabs are on the box.
 *
 * A dozen tabs in one window look identical, and the one difference that matters
 * — is this shell on the laptop or on the Hetzner server? — is invisible until
 * you type something into the wrong one. So every gjd-remote command that hands
 * the terminal over to the box paints the tab violet for as long as it holds it,
 * and puts it back afterwards.
 *
 * Split out from gjd-remote.ts so the byte sequences and the guards can be
 * tested without a terminal, the same reason gjd-remote-tmux.ts is its own file.
 *
 * ## Why an escape sequence and not AppleScript
 *
 * gjd-remote runs IN the tab it is colouring — mosh and ssh replace this
 * terminal's contents, they do not open a new one — so writing the sequence to
 * our own stdout reaches exactly the right tab, with no session lookup, no
 * Automation permission and nothing to get wrong about tab indices
 * (docs/reusable/iterm.md is a long list of ways addressing a tab goes wrong).
 *
 * There is no AppleScript route anyway. iTerm 3.6.6's dictionary has no
 * tab-colour property at all — `sdef /Applications/iTerm.app | grep -i 'tab
 * color'` is empty. It has `background color`, which is the pane fill, a
 * different thing. The only way to set the tab chip from outside the tab is the
 * Python API, which needs *Enable Python API* plus a WebSocket handshake.
 *
 * Sequences: https://iterm2.com/documentation-escape-codes.html
 */

export type Rgb = { r: number; g: number; b: number };

/**
 * A faded violet (Tailwind violet-400). Chosen by looking at it:
 *
 * > I was looking for the slightly more faded/violet fill
 * >
 * > — Greg, 2026-08-31
 *
 * iTerm fills the selected tab with the colour and outlines the unselected ones,
 * so a saturated purple reads as an alarm on whichever tab you are looking at.
 */
export const REMOTE_TAB_COLOUR = "#a78bfa";

/** The environment variable that turns it off, or picks a different colour. */
export const TAB_COLOUR_ENV = "GJD_REMOTE_TAB_COLOUR";

/** Off, a colour, or a value that is neither — the third is a mistake, not a
 *  default. See {@link wantedColour}. */
export type Wanted = { kind: "off" } | { kind: "colour"; rgb: Rgb } | { kind: "bad"; value: string };

function parseHex(hex: string): Rgb | undefined {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return undefined;
  const n = Number.parseInt(m[1] ?? "", 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * What the environment asks for: `off` (or `none`, or empty), or a `#rrggbb`.
 *
 * A value that is neither comes back as `bad` rather than quietly falling back
 * to the default. A mistyped colour that still paints the default tab colour is
 * a setting that looks honoured and is not — docs/reusable/silent-success.md.
 */
export function wantedColour(env: NodeJS.ProcessEnv): Wanted {
  const raw = env[TAB_COLOUR_ENV];
  if (raw === undefined) return { kind: "colour", rgb: parseHex(REMOTE_TAB_COLOUR)! };
  const want = raw.trim().toLowerCase();
  if (want === "" || want === "off" || want === "none") return { kind: "off" };
  const rgb = parseHex(want);
  return rgb ? { kind: "colour", rgb } : { kind: "bad", value: raw };
}

/**
 * Are we sure the bytes will reach iTerm and be swallowed by it?
 *
 * Fails closed every way, because the cost of being wrong is visible junk in
 * someone's terminal or, worse, in a file:
 *  - not a TTY — stdout is a pipe or a file, and the sequence would land in it
 *  - not iTerm — another terminal may print the sequence rather than eat it
 *  - tmux/screen — iTerm's own escape-code docs say its proprietary sequences
 *    "may not work properly" under a multiplexer, and the outer terminal there
 *    need not be iTerm at all. This is also what covers iTerm's `tmux -CC`.
 *  - ssh — TERM_PROGRAM is a plain variable and can arrive on the far side of a
 *    connection, where it describes the machine you came from. Same reasoning as
 *    docs/reusable/iterm.md, which refuses to touch a tab under ssh for exactly
 *    this: the identity in the environment is not the terminal in front of you.
 *  - CI — nothing there has a tab, and the bytes would only reach a log.
 *
 * Note this asks about the LOCAL terminal, before mosh starts. The remote tmux
 * on the box is downstream of the colour and cannot affect it.
 *
 * What it deliberately does NOT try to detect is a pty recorder such as
 * `script(1)`, which keeps TERM_PROGRAM and hands you a real tty. The sequence
 * both reaches the terminal and lands in the recording — but a terminal
 * recording is made of escape sequences, and gjd-remote already writes colour
 * codes into one through every `dim()` and `green()` in its output. Sniffing
 * for an ancestor process would be machinery bought for nothing.
 */
export function canColourTab(env: NodeJS.ProcessEnv, isTty: boolean): boolean {
  if (!isTty) return false;
  if (env.TERM_PROGRAM !== "iTerm.app") return false;
  if (env.TMUX || env.STY) return false;
  if (env.SSH_CONNECTION || env.SSH_TTY) return false;
  if (env.CI) return false;
  return true;
}

/**
 * The bytes for one colour, or for handing the tab back to its profile.
 *
 * OSC 6 takes one channel per sequence; there is no combined form in the
 * documented set, so a colour is three sequences and a reset is one. Verified
 * against a live iTerm 3.6.6 on 2026-08-31 by writing these exact bytes to a
 * session's tty and photographing the tab bar — see
 * docs/plans/260831ae-gjd-remote-iterm-tab-colour.md.
 */
export function colourSequence(colour: Rgb | "default"): string {
  // Written as \u escapes, never as literal control bytes: an invisible ESC in
  // source survives an editor, a diff and a grep right up until something
  // normalises it away, and then the tab simply never changes colour.
  const OSC = "\u001b]"; // ESC ] — opens an operating system command
  const BEL = "\u0007"; // BEL — terminates it
  if (colour === "default") return `${OSC}6;1;bg;*;default${BEL}`;
  const channel = (name: string, value: number) => `${OSC}6;1;bg;${name};brightness;${value}${BEL}`;
  return channel("red", colour.r) + channel("green", colour.g) + channel("blue", colour.b);
}
