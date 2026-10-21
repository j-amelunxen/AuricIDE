import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  InspectorResizer,
  clampInspectorWidth,
  parseStoredInspectorWidth,
} from './InspectorResizer';

function setup(width = 340) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(<InspectorResizer width={width} onChange={onChange} onCommit={onCommit} />);
  return { separator: screen.getByRole('separator'), onChange, onCommit };
}

describe('InspectorResizer', () => {
  it('reports its value in words', () => {
    const { separator } = setup(340);
    expect(separator).toHaveAttribute('aria-valuenow', '340');
    expect(separator).toHaveAttribute('aria-valuetext', '340 pixels');
  });

  it('shows where keyboard focus is', () => {
    const { separator } = setup();
    expect(separator.className).toContain('focus-visible:outline-2');
  });

  it('widens with ArrowLeft, narrows with ArrowRight, and remembers it', () => {
    const { separator, onChange, onCommit } = setup(340);
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(356);
    expect(onCommit).toHaveBeenLastCalledWith(356);
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(324);
  });

  it('jumps to the limits with Home and End', () => {
    const { separator, onChange } = setup();
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(INSPECTOR_MIN_WIDTH);
    fireEvent.keyDown(separator, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(INSPECTOR_MAX_WIDTH);
  });

  it('goes back to the default width on double-click', () => {
    const { separator, onChange, onCommit } = setup(500);
    fireEvent.doubleClick(separator);
    expect(onChange).toHaveBeenCalledWith(INSPECTOR_DEFAULT_WIDTH);
    expect(onCommit).toHaveBeenCalledWith(INSPECTOR_DEFAULT_WIDTH);
  });

  it('stops text selection while dragging and gives it back afterwards', () => {
    const { separator } = setup();
    separator.setPointerCapture = vi.fn();
    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 500 });
    expect(document.body.style.userSelect).toBe('none');
    fireEvent.pointerUp(separator, { pointerId: 1 });
    expect(document.body.style.userSelect).toBe('');
  });

  it('drags left to widen', () => {
    const { separator, onChange, onCommit } = setup(340);
    separator.setPointerCapture = vi.fn();
    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 450 });
    expect(onChange).toHaveBeenLastCalledWith(390);
    fireEvent.pointerUp(separator, { pointerId: 1 });
    expect(onCommit).toHaveBeenCalled();
  });
});

describe('width helpers', () => {
  it('clamps to the limits', () => {
    expect(clampInspectorWidth(100)).toBe(INSPECTOR_MIN_WIDTH);
    expect(clampInspectorWidth(900)).toBe(INSPECTOR_MAX_WIDTH);
  });
  it('falls back to the default for a missing or broken stored value', () => {
    expect(parseStoredInspectorWidth(null)).toBe(INSPECTOR_DEFAULT_WIDTH);
    expect(parseStoredInspectorWidth('abc')).toBe(INSPECTOR_DEFAULT_WIDTH);
    expect(parseStoredInspectorWidth('400')).toBe(400);
  });
});
