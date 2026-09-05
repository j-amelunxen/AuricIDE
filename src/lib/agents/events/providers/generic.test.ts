import { describe, expect, it } from 'vitest';
import { matchGenericLine } from './generic';

describe('matchGenericLine', () => {
  describe('a `>`-prefixed line', () => {
    it('is a run event when it is command-shaped', () => {
      expect(matchGenericLine('> pnpm test:run --reporter=verbose -t "epic"')).toEqual({
        kind: 'run',
        label: 'Ran pnpm test:run --reporter=verbose -t "epic"',
      });
    });

    it('is a run event for a plain two-word command', () => {
      expect(matchGenericLine('> git status')).toEqual({
        kind: 'run',
        label: 'Ran git status',
      });
    });

    it('is a run event for a relative-path script invocation', () => {
      expect(matchGenericLine('> ./scripts/build.sh --dmg')).toEqual({
        kind: 'run',
        label: 'Ran ./scripts/build.sh --dmg',
      });
    });

    it('is not a run event when it is the TUI echoing a prose prompt with a comma', () => {
      expect(
        matchGenericLine('> Ich habe so regelmäßige Situationen, dass ich in der Anwendung klicke')
      ).toBeNull();
    });

    it('is not a run event when it is a prose sentence ending in a period', () => {
      expect(matchGenericLine('> Please look at the file.')).toBeNull();
    });

    it('is not a run event when it is a prose sentence ending in a question mark', () => {
      expect(matchGenericLine('> Is this right?')).toBeNull();
    });
  });

  describe('a `$`-prefixed line', () => {
    it('is always a run event, prose included, unlike a `>` line', () => {
      expect(matchGenericLine('$ anything at all, even prose.')).toEqual({
        kind: 'run',
        label: 'Ran anything at all, even prose.',
      });
    });
  });

  describe('a read/edit line', () => {
    it('yields a read event when extractPath finds a path', () => {
      expect(matchGenericLine('Read src/lib/x.ts')).toEqual({
        kind: 'read',
        label: 'Read src/lib/x.ts',
        path: 'src/lib/x.ts',
      });
    });

    it('yields nothing for spinner text with no path in it', () => {
      expect(matchGenericLine('Read file...')).toBeNull();
    });

    it('yields nothing for spinner text with an ellipsis and no path', () => {
      expect(matchGenericLine('Reading files…')).toBeNull();
    });

    it('yields an edit event when extractPath finds a path', () => {
      expect(matchGenericLine('Wrote src/lib/new-feature.ts')).toEqual({
        kind: 'edit',
        label: 'Edited src/lib/new-feature.ts',
        path: 'src/lib/new-feature.ts',
      });
    });

    it('yields nothing for an edit line with no path in it', () => {
      expect(matchGenericLine('Updated 3 files')).toBeNull();
    });
  });
});
