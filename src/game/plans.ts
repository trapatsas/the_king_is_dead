/** JSON choices compare by value; object property order is not significant. */
export function sameChoice(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  ) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => sameChoice(value, b[index]))
    );
  }
  const left = Object.entries(a).sort(([x], [y]) => x.localeCompare(y));
  const right = Object.entries(b).sort(([x], [y]) => x.localeCompare(y));
  return (
    left.length === right.length &&
    left.every(([key, value], index) => {
      const entry = right[index];
      return (
        entry !== undefined && key === entry[0] && sameChoice(value, entry[1])
      );
    })
  );
}

/** Clone typed JSON plans before freezing them, without freezing caller data. */
export function copyChoice<T>(choice: T): T {
  return JSON.parse(JSON.stringify(choice)) as T;
}
