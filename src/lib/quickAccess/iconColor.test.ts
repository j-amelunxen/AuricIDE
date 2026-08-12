import { describe, expect, it } from 'vitest';
import { dominantIconHue, imageTileSurface, NEUTRAL_TILE_SURFACE } from './iconColor';
import { generateProjectIcon } from '../projectIcon';

/** Builds an RGBA buffer from [r,g,b,a] tuples, the shape getImageData returns. */
function pixels(...rgba: [number, number, number, number][]): Uint8ClampedArray {
  return new Uint8ClampedArray(rgba.flat());
}

/** `count` copies of one colour, opaque. */
function block(count: number, r: number, g: number, b: number): [number, number, number, number][] {
  return Array.from({ length: count }, () => [r, g, b, 255] as [number, number, number, number]);
}

describe('dominantIconHue', () => {
  it('reads the hue of a single-colour mark', () => {
    // Pure green (#00c853-ish) sits near 140°.
    const hue = dominantIconHue(pixels([0, 200, 83, 255]));
    expect(hue).not.toBeNull();
    expect(hue!).toBeGreaterThan(130);
    expect(hue!).toBeLessThan(155);
  });

  it('ignores fully transparent pixels, which are most of a favicon', () => {
    const buffer = pixels(...block(50, 0, 0, 0), ...block(1, 220, 40, 30));
    // The transparent block must not drag the answer toward a black hue.
    const transparent = new Uint8ClampedArray(buffer);
    for (let i = 0; i < 50; i++) transparent[i * 4 + 3] = 0;
    const hue = dominantIconHue(transparent);
    expect(hue).not.toBeNull();
    expect(hue!).toBeLessThan(20);
  });

  it('ignores near-white pixels, so a logo on a white plate keeps its own hue', () => {
    const buffer = pixels(...block(80, 252, 252, 252), ...block(20, 30, 90, 220));
    const hue = dominantIconHue(buffer);
    expect(hue).not.toBeNull();
    expect(hue!).toBeGreaterThan(200);
    expect(hue!).toBeLessThan(240);
  });

  it('ignores near-black pixels, which are outlines rather than brand colour', () => {
    const buffer = pixels(...block(80, 4, 4, 4), ...block(20, 240, 140, 20));
    const hue = dominantIconHue(buffer);
    expect(hue).not.toBeNull();
    expect(hue!).toBeGreaterThan(20);
    expect(hue!).toBeLessThan(45);
  });

  it('prefers the colourful pixels over a larger grey mass', () => {
    // Grey dominates by count, but says nothing about the brand.
    const buffer = pixels(...block(90, 128, 128, 128), ...block(10, 200, 20, 160));
    const hue = dominantIconHue(buffer);
    expect(hue).not.toBeNull();
    expect(hue!).toBeGreaterThan(290);
    expect(hue!).toBeLessThan(330);
  });

  it('picks the biggest colour when several compete, not an average of them', () => {
    // Averaging red and cyan would land on a hue present in neither.
    const buffer = pixels(...block(70, 230, 30, 30), ...block(30, 30, 210, 210));
    const hue = dominantIconHue(buffer);
    expect(hue).not.toBeNull();
    expect(hue! < 20 || hue! > 340).toBe(true);
  });

  it('gives up on a greyscale mark rather than inventing a colour', () => {
    expect(
      dominantIconHue(pixels(...block(40, 40, 40, 40), ...block(40, 200, 200, 200)))
    ).toBeNull();
  });

  it('gives up on an empty buffer', () => {
    expect(dominantIconHue(new Uint8ClampedArray())).toBeNull();
  });

  it('gives up when every pixel is transparent', () => {
    expect(
      dominantIconHue(pixels(...block(20, 200, 30, 30).map(([r, g, b]) => [r, g, b, 0])))
    ).toBeNull();
  });
});

describe('imageTileSurface', () => {
  it('keeps the icon’s own hue rather than opposing it', () => {
    const surface = imageTileSurface(140);
    expect(surface.from).toMatch(/^hsl\(140,/);
  });

  it('stays dark and quiet, so the mark on top is the brightest thing', () => {
    const surface = imageTileSurface(140);
    const [, , saturation, lightness] = surface.from
      .match(/hsl\((\d+), (\d+)%, (\d+)%\)/)!
      .map(Number);
    expect(saturation).toBeLessThanOrEqual(40);
    expect(lightness).toBeLessThanOrEqual(32);
  });

  it('holds one visual weight across every hue, so a row still reads as a set', () => {
    const weights = [0, 60, 140, 210, 300].map((hue) => {
      const [, , s, l] = imageTileSurface(hue)
        .from.match(/hsl\((\d+), (\d+)%, (\d+)%\)/)!
        .map(Number);
      return `${s}/${l}`;
    });
    expect(new Set(weights).size).toBe(1);
  });

  it('shifts the gradient end slightly, keeping the 135° sheen the other tiles have', () => {
    const surface = imageTileSurface(140);
    expect(surface.to).not.toBe(surface.from);
    expect(surface.to).toMatch(/^hsl\(/);
  });

  it('wraps the hue instead of running past 360', () => {
    expect(imageTileSurface(355).to).toMatch(/^hsl\([0-9]|^hsl\(3[0-5][0-9]/);
  });

  it('sits darker than a generated tile, which carries white initials instead', () => {
    const [, , , derived] = imageTileSurface(210)
      .from.match(/hsl\((\d+), (\d+)%, (\d+)%\)/)!
      .map(Number);
    const [, , , generated] = generateProjectIcon('/a/website')
      .gradientFrom.match(/hsl\((\d+), (\d+)%, (\d+)%\)/)!
      .map(Number);
    expect(derived).toBeLessThan(generated);
  });

  it('offers a neutral surface for marks with no colour to read', () => {
    const [, , s, l] = NEUTRAL_TILE_SURFACE.from.match(/hsl\((\d+), (\d+)%, (\d+)%\)/)!.map(Number);
    expect(s).toBeLessThanOrEqual(12);
    expect(l).toBeLessThanOrEqual(32);
  });
});
