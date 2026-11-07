import { describe, expect, it } from 'vitest';

import { readClaim, settledCandidate } from '../src/http/routes/name-suggestion.ts';

describe('what a join claims', () => {
  it('reads no name as a client from before the field, and a clean name as a claim', () => {
    // Act and assert
    expect(readClaim({ trade: 'weaver' })).toEqual({ kind: 'none' });
    expect(
      readClaim({ trade: 'weaver', candidate: { id: 'house-0b7c2f0e-2a51-4b4f-9a0e-3b8f0f5f5c11' }, name: ' Moreau ' }),
    ).toEqual({ kind: 'claimed', id: 'house-0b7c2f0e-2a51-4b4f-9a0e-3b8f0f5f5c11', name: 'Moreau' });
  });

  it('reads a body that cannot be a name as poisoned', () => {
    // Act and assert: a number, an id that is not a uuid, a candidate that is not an object.
    expect(readClaim({ trade: 'weaver', name: 42 })).toEqual({ kind: 'poisoned' });
    expect(readClaim({ trade: 'weaver', candidate: { id: 'leclerc' }, name: 'Moreau' })).toEqual({ kind: 'poisoned' });
    expect(readClaim({ trade: 'weaver', candidate: null })).toEqual({ kind: 'none' });
  });

  it('keeps the id of the candidate and judges the name it carries', () => {
    // Arrange
    const id = 'house-0b7c2f0e-2a51-4b4f-9a0e-3b8f0f5f5c11';

    // Act
    const kept = settledCandidate({ id, name: 'Moreau' }, []);
    const refused = settledCandidate({ id, name: 'Hébert' }, []);

    // Assert: the cut with the id, and nothing for a name the rule refuses.
    expect(kept?.id).toBe(id);
    expect(kept?.houseName).toBe('Moreau');
    expect(refused).toBeNull();
  });
});
