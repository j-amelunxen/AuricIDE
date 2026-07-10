import { describe, expect, it } from 'vitest';
import { buildExcalidrawFileJson } from './serialize';

describe('buildExcalidrawFileJson', () => {
  const elements = [{ id: 'r1', type: 'rectangle', x: 0, y: 0 }];

  it('produces the standard .excalidraw envelope', () => {
    const json = buildExcalidrawFileJson(elements, {}, {});
    const value = JSON.parse(json);
    expect(value.type).toBe('excalidraw');
    expect(value.version).toBe(2);
    expect(value.source).toBe('auric-ide');
    expect(value.elements).toHaveLength(1);
    expect(value.files).toEqual({});
  });

  it('keeps persistent appState like the background color', () => {
    const json = buildExcalidrawFileJson(elements, { viewBackgroundColor: '#fafafa' }, {});
    expect(JSON.parse(json).appState.viewBackgroundColor).toBe('#fafafa');
  });

  it('drops ephemeral appState so pan/zoom never dirties the file', () => {
    const json = buildExcalidrawFileJson(
      elements,
      {
        viewBackgroundColor: '#fff',
        scrollX: 120,
        scrollY: -40,
        zoom: { value: 1.5 },
        collaborators: new Map([['u1', {}]]),
        selectedElementIds: { r1: true },
      },
      {}
    );
    const appState = JSON.parse(json).appState;
    expect(appState).toEqual({ viewBackgroundColor: '#fff' });
  });

  it('is deterministic for identical scenes (usable as change guard)', () => {
    const a = buildExcalidrawFileJson(elements, { viewBackgroundColor: '#fff', scrollX: 1 }, {});
    const b = buildExcalidrawFileJson(elements, { viewBackgroundColor: '#fff', scrollX: 99 }, {});
    expect(a).toBe(b);
  });
});
