import { createHash } from 'node:crypto';

import { canonicalJson } from './canonical.ts';
import type { World } from './world.ts';

/**
 * Node-only for now. If the core ever has to run inside a browser tab, this
 * module is the single place that has to move to WebCrypto.
 */
export function stateHash(world: World): string {
  return createHash('sha256').update(canonicalJson(world), 'utf8').digest('hex');
}
