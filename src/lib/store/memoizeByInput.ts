/**
 * Remembers the last input and its result, compared by reference.
 *
 * A zustand selector runs on every store write anywhere, not only when the
 * field it reads changes. A selector that derives from a field — counting,
 * filtering — therefore redoes that work on every unrelated write. Wrapping
 * the derivation makes the repeat a reference check, and a derived array or
 * object keeps its identity until its input changes, which is what keeps a
 * zustand v5 selector from returning a new reference each call (React #185).
 */
export function memoizeByInput<I, O>(compute: (input: I) => O): (input: I) => O {
  let cached: { input: I; output: O } | null = null;
  return (input) => {
    if (cached === null || cached.input !== input) {
      cached = { input, output: compute(input) };
    }
    return cached.output;
  };
}
