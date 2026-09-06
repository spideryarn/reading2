/** One continuation per completed batch, after every tool result reaches the wire. */
export class ToolResponses {
  private readonly batches = new Map<string, {
    calls: Set<string>;
    completed: boolean;
    superseded: boolean;
    continued: boolean;
  }>();
  private readonly finished = new Set<string>();
  private readonly active = new Set<string>();
  private requested = false;

  created(id: string): void {
    this.requested = false;
    this.active.add(id);
    if (!this.batches.has(id)) {
      this.batches.set(id, { calls: new Set(), completed: false, superseded: false, continued: false });
    }
  }

  called(responseId: string, callId: string): void {
    let batch = this.batches.get(responseId);
    if (!batch) {
      batch = { calls: new Set(), completed: false, superseded: false, continued: false };
      this.batches.set(responseId, batch);
    }
    batch.calls.add(callId);
  }

  finishedCall(callId: string): void {
    this.finished.add(callId);
  }

  done(responseId: string, completed: boolean, calls: string[]): void {
    this.active.delete(responseId);
    for (const callId of calls) this.called(responseId, callId);
    const batch = this.batches.get(responseId);
    if (batch) {
      batch.completed = completed;
      if (!completed) batch.superseded = true;
    }
  }

  /** The next VAD turn will answer with any available results in its context. */
  interrupt(): void {
    for (const batch of this.batches.values()) batch.superseded = true;
  }

  takeContinuation(hearing: boolean): boolean {
    if (hearing || this.active.size > 0 || this.requested) return false;
    const ready = [...this.batches.values()].filter((batch) =>
      batch.completed && !batch.superseded && !batch.continued &&
      batch.calls.size > 0 && [...batch.calls].every((id) => this.finished.has(id)),
    );
    if (ready.length === 0) return false;
    for (const batch of ready) batch.continued = true;
    this.requested = true;
    return true;
  }

  get responding(): boolean {
    return this.active.size > 0 || this.requested;
  }
}
