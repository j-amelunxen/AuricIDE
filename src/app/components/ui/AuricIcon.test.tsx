import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuricIcon } from './AuricIcon';

describe('AuricIcon', () => {
  it('renders an svg tagged with the icon name', () => {
    const { container } = render(<AuricIcon name="folder" />);
    const svg = container.querySelector('svg[data-icon="folder"]');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
  });

  it('sizes via font-size (1em box) so existing text-size classes keep working', () => {
    const { container } = render(<AuricIcon name="folder" className="text-sm" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('1em');
    expect(svg?.getAttribute('height')).toBe('1em');
    expect(svg?.getAttribute('class')).toContain('text-sm');
  });

  it('is hidden from the accessibility tree by default', () => {
    const { container } = render(<AuricIcon name="folder" />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('exposes a label when title is given', () => {
    const { getByRole } = render(<AuricIcon name="folder" title="Open folder" />);
    expect(getByRole('img', { name: 'Open folder' })).toBeTruthy();
  });

  it('renders accent primitives with the primary token, line work with currentColor', () => {
    const { container } = render(<AuricIcon name="folder" />);
    const accent = container.querySelector('[fill="var(--primary)"]');
    expect(accent).toBeTruthy();
    expect(container.querySelector('svg')?.getAttribute('stroke')).toBe('currentColor');
  });

  it('renders an empty box for unknown names instead of crashing', () => {
    const { container } = render(<AuricIcon name="definitely_not_an_icon" />);
    const svg = container.querySelector('svg[data-icon="definitely_not_an_icon"]');
    expect(svg).toBeTruthy();
    expect(svg?.children.length).toBe(0);
  });
});
