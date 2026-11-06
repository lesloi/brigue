import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Renaming a script has to reach every command that names it: the package
// scripts here, and the workflows that run it. A path that points at nothing
// fails when the command runs, not when the rename lands.
const serverRoot = new URL('..', import.meta.url);
const repoRoot = new URL('../../../', import.meta.url);
const SCRIPT = /node (scripts\/[a-z0-9_.-]+\.ts)/g;

function referencedScripts(text: string): string[] {
  return [...text.matchAll(SCRIPT)].map((match) => match[1] as string);
}

function scriptExists(script: string): boolean {
  return existsSync(fileURLToPath(new URL(script, serverRoot)));
}

describe('the scripts a command names', () => {
  it('exist when a package script names one', async () => {
    // Arrange
    const manifest = JSON.parse(await readFile(new URL('package.json', serverRoot), 'utf8')) as {
      scripts: Record<string, string>;
    };

    // Act
    const scripts = referencedScripts(Object.values(manifest.scripts).join('\n'));

    // Assert
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(scriptExists(script), script).toBe(true);
    }
  });

  it('exist when the release workflow names one', async () => {
    // Arrange
    const workflow = await readFile(new URL('.github/workflows/release.yml', repoRoot), 'utf8');

    // Act
    const scripts = referencedScripts(workflow);

    // Assert: the format-3 release names no script of its own, so this only
    // guards whatever step a later release adds.
    for (const script of scripts) {
      expect(scriptExists(script), script).toBe(true);
    }
  });
});
