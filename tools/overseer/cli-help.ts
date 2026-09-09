/**
 * **The root help: prose we write, usage rows the parser generates.**
 *
 * `scripts/overseer.ts` used to hand-write both, and that is the drift this
 * whole CLI exists to remove — a flag added to a subcommand and not to the help
 * text is a flag the Overseer never finds. Commander knows every command's
 * arguments and options because it had to, in order to parse them, so the rows
 * are read back out of it rather than restated.
 *
 * **The prose stays hand-written and interleaved.** Commander's own
 * `--help` is a good reference page and a poor briefing: it cannot say that
 * `attention` costs money, or that the scheduler is off unless somebody said so
 * out loud. Those paragraphs are the reason a person reads this help at all, so
 * the renderer takes them as text and puts the generated rows between them.
 *
 * The same split `gjd-remote` chose on 2026-09-09 (session
 * `gjd-remote-argument-parsing`, on GPT Sol's advice): **Commander owns grammar
 * and metadata; the document owns narrative.** One parser in the repo, per
 * docs/reusable/third-party-library-selection.md.
 *
 * NO IMPORT SIDE EFFECTS: nothing here runs a command or reads the environment,
 * so a test can render the help of a program it built in memory.
 */
import type { Command } from "commander";

/**
 * One usage line per subcommand, in declaration order.
 *
 * `  <prefix> <name> <args…> [--flag <value>] …`
 *
 * Options are printed in the order they were registered, with Commander's own
 * `flags` string, so what a reader sees is literally what the parser accepts.
 * A **mandatory** option is printed bare and everything else is wrapped in
 * square brackets — the convention every man page uses, and the one thing here
 * that is a choice rather than a transcription.
 *
 * **`option.mandatory`, not `option.required`.** They read like synonyms and are
 * different questions: `required` is *this option's value is not optional*
 * (`--sha <sha>` has it, `--dry-run` does not), while `mandatory` is *the
 * command refuses to run without this option*. Using `required` here printed
 * `--sha <sha>` as though it were compulsory and `[--limit <n>]` correctly, in
 * the same list, which is the sort of help nobody notices is wrong.
 */
export function usageRows(program: Command, prefix: string): string[] {
  const rows: string[] = [];
  for (const command of program.commands) {
    // A command marked hidden is not part of the vocabulary; Commander hides it
    // from its own help and so does this.
    if ((command as { _hidden?: boolean })._hidden === true) continue;
    const here = `${prefix} ${command.name()}`;
    // A GROUP GETS NO ROW OF ITS OWN — its leaves do. `mine` is not a thing you
    // can run; `mine add <name>` is. A row for the group would be a line naming
    // no arguments and no options, which reads as a command that takes neither.
    if (command.commands.length > 0) {
      rows.push(...usageRows(command, here));
      continue;
    }
    const parts = [here];
    parts.push(...command.registeredArguments.map((a) => (a.required ? `<${a.name()}>` : `[${a.name()}]`)));
    for (const option of command.options) {
      if (option.hidden) continue;
      parts.push(option.mandatory ? option.flags : `[${option.flags}]`);
    }
    rows.push(`  ${parts.join(" ")}`);
  }
  return rows;
}

/**
 * The whole root help: a title, the generated rows, then the prose.
 *
 * `before` and `after` are blocks of already-written text. They are joined with
 * blank lines rather than concatenated, so a paragraph cannot accidentally run
 * into a usage row.
 */
export function renderRootHelp(input: {
  program: Command;
  prefix: string;
  title: string;
  before?: readonly string[];
  after?: readonly string[];
}): string {
  const blocks: string[] = [input.title];
  for (const block of input.before ?? []) blocks.push(block);
  blocks.push(usageRows(input.program, input.prefix).join("\n"));
  for (const block of input.after ?? []) blocks.push(block);
  return blocks.join("\n\n");
}
