/** A resumed cell must still answer the same request; a filename alone proves nothing. */
export function assertResumeIdentity(
  label: string,
  stored: { request: unknown; effortSent: string | null; effortRan: string },
  request: unknown,
  effort: { sent: string | null; ran: string },
): void {
  if (JSON.stringify(stored.request) !== JSON.stringify(request) ||
      stored.effortSent !== effort.sent || stored.effortRan !== effort.ran) {
    throw new Error(`${label}: saved request or effort differs; use a fresh --out directory`);
  }
}

/** Scores remain usable only while both the blind packet and its key match. */
export function assertJudgedInputsMatch(slug: string, oldKey: unknown, key: unknown, oldText: string, text: string): void {
  if (JSON.stringify(oldKey) !== JSON.stringify(key) || oldText !== text) {
    throw new Error(`${slug}: judging inputs changed; use a fresh run and obtain new judgements`);
  }
}
