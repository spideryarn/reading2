/** Compare answers separately from the titles production stores after fallback. */
export type Input = { id: number; set: string; title: string; site_name?: string | null; lang?: string | null };
export type Row = {
  inputId: number;
  arm: string;
  run: number;
  set: string;
  title: string;
  out: string | null;
  error: string | null;
  nanos: number;
  ms: number;
  upstream: string | null;
  inTok: number;
  outTok: number;
  reasonTok: number;
  retries: number;
};

export function rowFor(rows: Row[], arm: string, run: number, inputId: number): Row | undefined {
  return rows.find((r) => r.arm === arm && r.run === run && r.inputId === inputId);
}

export function summarizeArm(inputs: Input[], rows: Row[], rule: Map<number, string>, arm: string, runs: number) {
  const mine = rows.filter((r) => r.arm === arm);
  const first = mine.filter((r) => r.run === 1);
  const errors = mine.filter((r) => r.error !== null);
  const stored = (run: number, input: Input) => rowFor(rows, arm, run, input.id)?.out ?? rule.get(input.id);
  return {
    mine, first, errors,
    modelChanged: first.filter((r) => r.out !== null && r.out !== r.title).length,
    storedChanged: inputs.filter((i) => stored(1, i) !== i.title).length,
    differsFromRule: inputs.filter((i) => stored(1, i) !== rule.get(i.id)).length,
    rawDisagree: inputs.filter((i) => runs > 1 && rowFor(rows, arm, 1, i.id)?.out !== rowFor(rows, arm, 2, i.id)?.out).length,
    storedDisagree: inputs.filter((i) => runs > 1 && stored(1, i) !== stored(2, i)).length,
  };
}
