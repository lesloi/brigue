import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// `packages/core` reaches for node:crypto through its hash module. A type-only
// import is erased, but one accidental value import would put `node:` in the
// browser bundle and only fail at runtime, on the phone. Catch it at build.
const DIST = join(import.meta.dirname, '..', 'dist');
const NODE_IMPORT = /(?:from|import)\s*\(?\s*['"]node:/;

async function* files(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* files(path);
    } else if (entry.name.endsWith('.js')) {
      yield path;
    }
  }
}

const offenders = [];
for await (const path of files(DIST)) {
  const source = await readFile(path, 'utf8');
  if (NODE_IMPORT.test(source)) {
    offenders.push(path);
  }
}

if (offenders.length > 0) {
  throw new Error(`node: import found in ${offenders.join(', ')}`);
}
