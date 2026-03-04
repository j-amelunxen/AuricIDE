import { describe, expect, it } from 'vitest';
import { getObsidianColor, parseObsidianCanvas, serializeObsidianCanvas } from '../canvasParser';
import type { ObsidianCanvasData } from '../types';

const EXAMPLE_CANVAS = JSON.stringify({
  nodes: [
    {
      id: 'f7641d584ba38583',
      type: 'text',
      text: '# software-architecture.ai',
      x: -20,
      y: -140,
      width: 220,
      height: 80,
    },
    {
      id: '2a8841bc7469c4e8',
      type: 'text',
      text: '## Leads',
      x: 200,
      y: 0,
      width: 100,
      height: 60,
      color: '4',
    },
  ],
  edges: [
    {
      id: 'aef82c0342aaecc7',
      fromNode: 'f7641d584ba38583',
      fromSide: 'bottom',
      toNode: '2a8841bc7469c4e8',
      toSide: 'top',
    },
  ],
});

describe('getObsidianColor', () => {
  it('maps color 1 to red', () => {
    expect(getObsidianColor('1')).toBe('#fb464c');
  });

  it('maps color 2 to orange', () => {
    expect(getObsidianColor('2')).toBe('#e9973f');
  });

  it('maps color 3 to yellow', () => {
    expect(getObsidianColor('3')).toBe('#e0de71');
  });

  it('maps color 4 to green', () => {
    expect(getObsidianColor('4')).toBe('#44cf6e');
  });

  it('maps color 5 to teal', () => {
    expect(getObsidianColor('5')).toBe('#53dfdd');
  });

  it('maps color 6 to purple', () => {
    expect(getObsidianColor('6')).toBe('#a882ff');
  });

  it('returns the default color for undefined', () => {
    expect(getObsidianColor(undefined)).toBe('#585858');
  });

  it('returns the default color for an unrecognized value', () => {
    expect(getObsidianColor('red')).toBe('#585858');
  });
});

describe('parseObsidianCanvas', () => {
  it('parses all 4 node types from valid canvas JSON', () => {
    const canvas = JSON.stringify({
      nodes: [
        { id: 'n1', type: 'text', text: 'hello', x: 0, y: 0, width: 100, height: 50 },
        { id: 'n2', type: 'file', file: 'notes/foo.md', x: 100, y: 0, width: 100, height: 50 },
        {
          id: 'n3',
          type: 'link',
          url: 'https://example.com',
          x: 200,
          y: 0,
          width: 100,
          height: 50,
        },
        {
          id: 'n4',
          type: 'group',
          label: 'My Group',
          x: 300,
          y: 0,
          width: 200,
          height: 200,
        },
      ],
      edges: [],
    });

    const result = parseObsidianCanvas(canvas);

    expect(result.nodes).toHaveLength(4);
    expect(result.nodes[0].type).toBe('text');
    expect(result.nodes[1].type).toBe('file');
    expect(result.nodes[2].type).toBe('link');
    expect(result.nodes[3].type).toBe('group');
  });

  it('parses an empty string to empty data', () => {
    const result = parseObsidianCanvas('');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('parses whitespace-only string to empty data', () => {
    const result = parseObsidianCanvas('   \n  ');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('parses "{}" to empty data', () => {
    const result = parseObsidianCanvas('{}');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('defaults x and y to 0 when missing', () => {
    const canvas = JSON.stringify({
      nodes: [{ id: 'n1', type: 'text', text: 'hi', width: 100, height: 50 }],
      edges: [],
    });

    const result = parseObsidianCanvas(canvas);

    expect(result.nodes[0].x).toBe(0);
    expect(result.nodes[0].y).toBe(0);
  });

  it('defaults an unknown node type to "text"', () => {
    const canvas = JSON.stringify({
      nodes: [{ id: 'n1', type: 'video', x: 0, y: 0, width: 100, height: 50 }],
      edges: [],
    });

    const result = parseObsidianCanvas(canvas);

    expect(result.nodes[0].type).toBe('text');
  });

  it('preserves all fields for a text node', () => {
    const result = parseObsidianCanvas(EXAMPLE_CANVAS);
    const node = result.nodes[0];

    expect(node.id).toBe('f7641d584ba38583');
    expect(node.type).toBe('text');
    if (node.type === 'text') {
      expect(node.text).toBe('# software-architecture.ai');
    }
    expect(node.x).toBe(-20);
    expect(node.y).toBe(-140);
    expect(node.width).toBe(220);
    expect(node.height).toBe(80);
  });

  it('preserves the color field when present', () => {
    const result = parseObsidianCanvas(EXAMPLE_CANVAS);
    const coloredNode = result.nodes[1];

    expect(coloredNode.color).toBe('4');
  });

  it('omits color when not present in source', () => {
    const result = parseObsidianCanvas(EXAMPLE_CANVAS);
    const plainNode = result.nodes[0];

    expect(plainNode.color).toBeUndefined();
  });

  it('preserves all fields for a file node', () => {
    const canvas = JSON.stringify({
      nodes: [
        { id: 'f1', type: 'file', file: 'docs/readme.md', x: 10, y: 20, width: 150, height: 75 },
      ],
      edges: [],
    });

    const result = parseObsidianCanvas(canvas);
    const node = result.nodes[0];

    expect(node.type).toBe('file');
    if (node.type === 'file') {
      expect(node.file).toBe('docs/readme.md');
    }
  });

  it('preserves all fields for a link node', () => {
    const canvas = JSON.stringify({
      nodes: [
        { id: 'l1', type: 'link', url: 'https://obsidian.md', x: 0, y: 0, width: 200, height: 100 },
      ],
      edges: [],
    });

    const result = parseObsidianCanvas(canvas);
    const node = result.nodes[0];

    expect(node.type).toBe('link');
    if (node.type === 'link') {
      expect(node.url).toBe('https://obsidian.md');
    }
  });

  it('preserves all fields for a group node including optional label and background', () => {
    const canvas = JSON.stringify({
      nodes: [
        {
          id: 'g1',
          type: 'group',
          label: 'Infrastructure',
          background: 'assets/bg.png',
          x: 0,
          y: 0,
          width: 400,
          height: 300,
        },
      ],
      edges: [],
    });

    const result = parseObsidianCanvas(canvas);
    const node = result.nodes[0];

    expect(node.type).toBe('group');
    if (node.type === 'group') {
      expect(node.label).toBe('Infrastructure');
      expect(node.background).toBe('assets/bg.png');
    }
  });

  it('handles group node with missing optional fields', () => {
    const canvas = JSON.stringify({
      nodes: [{ id: 'g1', type: 'group', x: 0, y: 0, width: 300, height: 200 }],
      edges: [],
    });

    const result = parseObsidianCanvas(canvas);
    const node = result.nodes[0];

    expect(node.type).toBe('group');
    if (node.type === 'group') {
      expect(node.label).toBeUndefined();
      expect(node.background).toBeUndefined();
    }
  });

  it('parses edges with all optional fields', () => {
    const result = parseObsidianCanvas(EXAMPLE_CANVAS);
    const edge = result.edges[0];

    expect(edge.id).toBe('aef82c0342aaecc7');
    expect(edge.fromNode).toBe('f7641d584ba38583');
    expect(edge.fromSide).toBe('bottom');
    expect(edge.toNode).toBe('2a8841bc7469c4e8');
    expect(edge.toSide).toBe('top');
  });

  it('parses edges with only required fields', () => {
    const canvas = JSON.stringify({
      nodes: [],
      edges: [{ id: 'e1', fromNode: 'a', toNode: 'b' }],
    });

    const result = parseObsidianCanvas(canvas);
    const edge = result.edges[0];

    expect(edge.id).toBe('e1');
    expect(edge.fromNode).toBe('a');
    expect(edge.toNode).toBe('b');
    expect(edge.fromSide).toBeUndefined();
    expect(edge.toSide).toBeUndefined();
    expect(edge.color).toBeUndefined();
    expect(edge.label).toBeUndefined();
  });

  it('throws on invalid JSON', () => {
    expect(() => parseObsidianCanvas('not json {')).toThrow();
  });
});

describe('serializeObsidianCanvas', () => {
  it('produces pretty-printed JSON with 2-space indent', () => {
    const data: ObsidianCanvasData = { nodes: [], edges: [] };
    const result = serializeObsidianCanvas(data);

    expect(result).toBe(JSON.stringify({ nodes: [], edges: [] }, null, 2));
  });

  it('omits optional node fields when undefined', () => {
    const data: ObsidianCanvasData = {
      nodes: [{ id: 'n1', type: 'text', text: 'hello', x: 0, y: 0, width: 100, height: 50 }],
      edges: [],
    };

    const result = serializeObsidianCanvas(data);
    const parsed = JSON.parse(result);

    expect(parsed.nodes[0]).not.toHaveProperty('color');
  });

  it('omits optional edge fields when undefined', () => {
    const data: ObsidianCanvasData = {
      nodes: [],
      edges: [{ id: 'e1', fromNode: 'a', toNode: 'b' }],
    };

    const result = serializeObsidianCanvas(data);
    const parsed = JSON.parse(result);

    expect(parsed.edges[0]).not.toHaveProperty('fromSide');
    expect(parsed.edges[0]).not.toHaveProperty('toSide');
    expect(parsed.edges[0]).not.toHaveProperty('color');
    expect(parsed.edges[0]).not.toHaveProperty('label');
  });

  it('includes optional fields when defined', () => {
    const data: ObsidianCanvasData = {
      nodes: [
        { id: 'n1', type: 'text', text: 'hi', x: 0, y: 0, width: 100, height: 50, color: '3' },
      ],
      edges: [
        {
          id: 'e1',
          fromNode: 'a',
          toNode: 'b',
          fromSide: 'right',
          toSide: 'left',
          color: '2',
          label: 'connects',
        },
      ],
    };

    const result = serializeObsidianCanvas(data);
    const parsed = JSON.parse(result);

    expect(parsed.nodes[0].color).toBe('3');
    expect(parsed.edges[0].fromSide).toBe('right');
    expect(parsed.edges[0].toSide).toBe('left');
    expect(parsed.edges[0].color).toBe('2');
    expect(parsed.edges[0].label).toBe('connects');
  });
});

describe('round-trip fidelity', () => {
  it('parse(serialize(data)) preserves all data', () => {
    const original: ObsidianCanvasData = {
      nodes: [
        {
          id: 'n1',
          type: 'text',
          text: 'Hello world',
          x: 10,
          y: 20,
          width: 200,
          height: 100,
          color: '1',
        },
        { id: 'n2', type: 'file', file: 'docs/readme.md', x: 300, y: 20, width: 150, height: 75 },
        {
          id: 'n3',
          type: 'link',
          url: 'https://example.com',
          x: 500,
          y: 20,
          width: 200,
          height: 100,
        },
        { id: 'n4', type: 'group', label: 'Cluster', x: 0, y: 200, width: 800, height: 400 },
      ],
      edges: [
        { id: 'e1', fromNode: 'n1', toNode: 'n2', fromSide: 'right', toSide: 'left' },
        { id: 'e2', fromNode: 'n2', toNode: 'n3', color: '5', label: 'flows to' },
      ],
    };

    const serialized = serializeObsidianCanvas(original);
    const reparsed = parseObsidianCanvas(serialized);

    expect(reparsed.nodes).toHaveLength(original.nodes.length);
    expect(reparsed.edges).toHaveLength(original.edges.length);

    expect(reparsed.nodes[0]).toEqual(original.nodes[0]);
    expect(reparsed.nodes[1]).toEqual(original.nodes[1]);
    expect(reparsed.nodes[2]).toEqual(original.nodes[2]);
    expect(reparsed.nodes[3]).toEqual(original.nodes[3]);

    expect(reparsed.edges[0]).toEqual(original.edges[0]);
    expect(reparsed.edges[1]).toEqual(original.edges[1]);
  });
});
