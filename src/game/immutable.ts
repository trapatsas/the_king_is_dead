/** Canonical snapshots contain only acyclic JSON data. Do not freeze callers. */
export function freezeSnapshot<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      freezeSnapshot(child);
    }
    Object.freeze(value);
  }
  return value;
}
