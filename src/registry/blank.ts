/**
 * The one definition of a blank KEY, shared by `transform`'s executor and the
 * validator that admits its config.
 *
 * A key is the string trimmed by JavaScript's `String.prototype.trim()` --
 * ECMAScript WhiteSpace and LineTerminator: tab, vertical tab, form feed, space,
 * U+00A0, U+FEFF, every Unicode `Zs` space, LF, CR, U+2028 and U+2029. A
 * non-string is no key at all. It is blank when that leaves `""`.
 *
 * It lives in its own module because the two callers used to carry their own
 * reading of "blank": the validator compared with `""`, the executor trimmed,
 * so `{ key: "   ", value: "x" }` was admitted and then dropped at run time.
 */
export function trimmedKey(key: unknown): string {
  return typeof key === "string" ? key.trim() : "";
}
