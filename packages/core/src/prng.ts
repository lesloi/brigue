/**
 * MINSTD, a Lehmer generator. 48271 * (2^31 - 1) stays below 2^53, so the
 * arithmetic is exact in a JavaScript double: no BigInt needed, and the same
 * constants give the same stream in every language we ever port this to.
 *
 * Nothing in the simulation may call Math.random: the whole world is replayable
 * from one seed, and that only holds if the generator is ours.
 */

export const MINSTD_MODULUS = 2147483647;

export function advance(state: number): number {
  return (state * 48271) % MINSTD_MODULUS;
}

/** Returns the new generator state and a draw in [0, bound). */
export function drawBelow(state: number, bound: number): [state: number, value: number] {
  if (!Number.isInteger(bound) || bound <= 0) {
    throw new RangeError(`drawBelow needs a positive integer bound, got ${bound}`);
  }

  const next = advance(state);

  return [next, next % bound];
}
