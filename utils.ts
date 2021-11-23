export const hex16 = (arr: ArrayBufferLike) =>
  Array.from(new Uint8Array(arr))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export type ArrayDiff<T> = {
  created: T[];
  removed: T[];
};
export function diffArray<T>(before: T[], after: T[]): ArrayDiff<T> {
  return {
    created: after.filter((v) => !(before.includes(v))),
    removed: before.filter((v) => !(after.includes(v))),
  };
}
