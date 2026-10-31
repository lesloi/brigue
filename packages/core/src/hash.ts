import { createHash } from 'node:crypto';

import { canonicalJson } from './canonical.ts';
import type { World } from './world.ts';

/**
 * Node-only for now. If the core ever has to run inside a browser tab, this
 * module is the single place that has to move to WebCrypto.
 */
export function stateHash(world: World): string {
  return hashJson(world);
}

/**
 * The same hash over anything canonical-JSON can hold. The API hashes the
 * projection it returns rather than the world, because the world hash includes
 * the seed and would hand a patient client the town's whole future.
 */
export function hashJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
