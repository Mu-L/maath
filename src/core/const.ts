/**
 * A read-only view of a math type: recursively makes properties and elements of
 * plain objects, arrays, and tuples read-only. The analogue of `const` on an input.
 */
export type Const<T> = { readonly [K in keyof T]: Const<T[K]> };
