export type ProgressSequenceKey = readonly [string, string, string, number];

export function progressSequenceKey(
  owner: Readonly<{ apiOrigin: string; userId: string; journalId: string }>,
  sequence: number,
): ProgressSequenceKey {
  const key: ProgressSequenceKey = [owner.apiOrigin, owner.userId, owner.journalId, sequence];

  return Object.freeze(key);
}
