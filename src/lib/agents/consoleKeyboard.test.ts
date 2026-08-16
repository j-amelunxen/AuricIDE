import { describe, expect, it } from 'vitest';
import {
  isConsoleNavKey,
  isTypingTarget,
  nextCardIndex,
  type ConsoleCardRef,
} from './consoleKeyboard';

/** Two projects: acme holds three cards, other holds two. */
const CARDS: ConsoleCardRef[] = [
  { agentId: 'a1', repoPath: '/repos/acme' },
  { agentId: 'a2', repoPath: '/repos/acme' },
  { agentId: 'a3', repoPath: '/repos/acme' },
  { agentId: 'b1', repoPath: '/repos/other' },
  { agentId: 'b2', repoPath: '/repos/other' },
];

describe('isConsoleNavKey', () => {
  it('accepts the arrows plus Home and End', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End']) {
      expect(isConsoleNavKey(key)).toBe(true);
    }
  });

  it('rejects everything else', () => {
    for (const key of ['Enter', 't', 'Escape', 'PageDown', ' ']) {
      expect(isConsoleNavKey(key)).toBe(false);
    }
  });
});

describe('nextCardIndex', () => {
  it('steps one card down and up', () => {
    expect(nextCardIndex(CARDS, 0, 'ArrowDown')).toBe(1);
    expect(nextCardIndex(CARDS, 2, 'ArrowUp')).toBe(1);
  });

  it('stops at both ends rather than wrapping', () => {
    expect(nextCardIndex(CARDS, 0, 'ArrowUp')).toBeNull();
    expect(nextCardIndex(CARDS, CARDS.length - 1, 'ArrowDown')).toBeNull();
  });

  it('crosses a project boundary going down, one card at a time', () => {
    // Down is a flat walk — it does not skip the rest of a project.
    expect(nextCardIndex(CARDS, 2, 'ArrowDown')).toBe(3);
  });

  it('jumps to the next project with right, from anywhere inside the current one', () => {
    expect(nextCardIndex(CARDS, 0, 'ArrowRight')).toBe(3);
    expect(nextCardIndex(CARDS, 1, 'ArrowRight')).toBe(3);
    expect(nextCardIndex(CARDS, 2, 'ArrowRight')).toBe(3);
  });

  it('jumps to the previous project with left, landing on its first card', () => {
    expect(nextCardIndex(CARDS, 3, 'ArrowLeft')).toBe(0);
    expect(nextCardIndex(CARDS, 4, 'ArrowLeft')).toBe(0);
  });

  it('has no project to the left of the first or right of the last', () => {
    expect(nextCardIndex(CARDS, 0, 'ArrowLeft')).toBeNull();
    expect(nextCardIndex(CARDS, 4, 'ArrowRight')).toBeNull();
  });

  it('goes to the first and last card with Home and End', () => {
    expect(nextCardIndex(CARDS, 3, 'Home')).toBe(0);
    expect(nextCardIndex(CARDS, 1, 'End')).toBe(4);
  });

  it('reports no move when Home or End is already satisfied', () => {
    expect(nextCardIndex(CARDS, 0, 'Home')).toBeNull();
    expect(nextCardIndex(CARDS, 4, 'End')).toBeNull();
  });

  it('enters the grid at the top when nothing is focused yet', () => {
    expect(nextCardIndex(CARDS, -1, 'ArrowUp')).toBe(0);
    expect(nextCardIndex(CARDS, -1, 'ArrowDown')).toBe(0);
  });

  it('has nowhere to go in an empty grid', () => {
    expect(nextCardIndex([], -1, 'ArrowDown')).toBeNull();
  });

  it('treats a single-card project as its own section', () => {
    const single: ConsoleCardRef[] = [
      { agentId: 'x', repoPath: '/a' },
      { agentId: 'y', repoPath: '/b' },
      { agentId: 'z', repoPath: '/c' },
    ];
    expect(nextCardIndex(single, 0, 'ArrowRight')).toBe(1);
    expect(nextCardIndex(single, 1, 'ArrowRight')).toBe(2);
    expect(nextCardIndex(single, 2, 'ArrowLeft')).toBe(1);
  });
});

describe('isTypingTarget', () => {
  it('recognises the fields a keystroke belongs to as text', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(isTypingTarget(document.createElement(tag))).toBe(true);
    }
  });

  it('recognises a contenteditable region', () => {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    // jsdom does not derive isContentEditable from the attribute.
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isTypingTarget(div)).toBe(true);
  });

  it('leaves ordinary elements and non-elements alone', () => {
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
