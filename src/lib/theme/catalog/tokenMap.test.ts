import { describe, expect, it } from 'vitest';
import { buildCssBag, hexToRgbChannels } from './tokenMap';

describe('hexToRgbChannels', () => {
  it('parses #rrggbb', () => {
    expect(hexToRgbChannels('#bc13fe')).toBe('188, 19, 254');
  });

  it('parses #rgb', () => {
    expect(hexToRgbChannels('#f0a')).toBe('255, 0, 170');
  });

  it('returns null for non-hex', () => {
    expect(hexToRgbChannels('rgba(1,2,3,0.5)')).toBeNull();
  });
});

describe('buildCssBag', () => {
  it('dual-writes primary and derives rgb', () => {
    const bag = buildCssBag({ primary: '#2f6bff', primaryLight: '#6b9bff' });
    expect(bag['--primary']).toBe('#2f6bff');
    expect(bag['--color-primary']).toBe('#2f6bff');
    expect(bag['--primary-rgb']).toBe('47, 107, 255');
    expect(bag['--primary-light']).toBe('#6b9bff');
    expect(bag['--primary-light-rgb']).toBe('107, 155, 255');
  });

  it('writes optional surface tokens', () => {
    const bag = buildCssBag({
      primary: '#fff',
      background: '#050508',
      bodyGradientFrom: '#12121a',
    });
    expect(bag['--background']).toBe('#050508');
    expect(bag['--color-background']).toBe('#050508');
    expect(bag['--body-gradient-from']).toBe('#12121a');
  });

  it('writes secondary accent tokens with rgb derive', () => {
    const bag = buildCssBag({
      primary: '#5BCEFA',
      primaryLight: '#9DE0FC',
      secondary: '#F5A9B8',
      secondaryLight: '#FBC9D4',
    });
    expect(bag['--secondary']).toBe('#F5A9B8');
    expect(bag['--color-secondary']).toBe('#F5A9B8');
    expect(bag['--secondary-rgb']).toBe('245, 169, 184');
    expect(bag['--secondary-light']).toBe('#FBC9D4');
  });

  it('writes panel/editor/glass surface tokens for true-black themes', () => {
    const bag = buildCssBag({
      primary: '#5BCEFA',
      panelBg: '#000000',
      editorBg: '#000000',
      glassBg: '#000000',
      glassPanelBg: '#000000',
    });
    expect(bag['--panel-bg']).toBe('#000000');
    expect(bag['--color-panel-bg']).toBe('#000000');
    expect(bag['--editor-bg']).toBe('#000000');
    expect(bag['--color-editor-bg']).toBe('#000000');
    expect(bag['--glass-bg']).toBe('#000000');
    expect(bag['--glass-panel-bg']).toBe('#000000');
  });
});
