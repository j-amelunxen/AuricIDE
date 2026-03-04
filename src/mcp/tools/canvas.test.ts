import { describe, expect, it } from 'vitest';
import type { ObsidianCanvasData } from '../../lib/obsidian-canvas/types';
import { applyOperations, assertWithinProject, buildEmbedOperations } from './canvas';

function emptyCanvas(): ObsidianCanvasData {
  return { nodes: [], edges: [] };
}

describe('canvas MCP tools', () => {
  describe('applyOperations — add_node', () => {
    it('adds a text node', () => {
      const { data, refMap } = applyOperations(emptyCanvas(), [
        { op: 'add_node', type: 'text', text: 'Hello', x: 0, y: 0, width: 200, height: 100 },
      ]);
      expect(data.nodes).toHaveLength(1);
      const node = data.nodes[0];
      expect(node.type).toBe('text');
      expect(node.type === 'text' && node.text).toBe('Hello');
      expect(node.x).toBe(0);
      expect(node.width).toBe(200);
      expect(node.id).toMatch(/^[0-9a-f]{16}$/);
      expect(Object.keys(refMap)).toHaveLength(0);
    });

    it('adds a file node', () => {
      const { data } = applyOperations(emptyCanvas(), [
        {
          op: 'add_node',
          type: 'file',
          file: 'docs/readme.md',
          x: 10,
          y: 20,
          width: 300,
          height: 150,
        },
      ]);
      expect(data.nodes).toHaveLength(1);
      expect(data.nodes[0].type).toBe('file');
      expect(data.nodes[0].type === 'file' && data.nodes[0].file).toBe('docs/readme.md');
    });

    it('adds a link node', () => {
      const { data } = applyOperations(emptyCanvas(), [
        {
          op: 'add_node',
          type: 'link',
          url: 'https://example.com',
          x: 0,
          y: 0,
          width: 200,
          height: 100,
        },
      ]);
      expect(data.nodes[0].type).toBe('link');
      expect(data.nodes[0].type === 'link' && data.nodes[0].url).toBe('https://example.com');
    });

    it('adds a group node with optional label and background', () => {
      const { data } = applyOperations(emptyCanvas(), [
        {
          op: 'add_node',
          type: 'group',
          label: 'My Group',
          background: '#ff0000',
          x: 0,
          y: 0,
          width: 400,
          height: 300,
        },
      ]);
      const node = data.nodes[0];
      expect(node.type).toBe('group');
      expect(node.type === 'group' && node.label).toBe('My Group');
      expect(node.type === 'group' && node.background).toBe('#ff0000');
    });

    it('stores ref in refMap when ref is provided', () => {
      const { data, refMap } = applyOperations(emptyCanvas(), [
        {
          op: 'add_node',
          ref: 'start',
          type: 'text',
          text: 'Start',
          x: 0,
          y: 0,
          width: 200,
          height: 100,
        },
      ]);
      expect(refMap['start']).toBe(data.nodes[0].id);
    });

    it('applies optional color', () => {
      const { data } = applyOperations(emptyCanvas(), [
        {
          op: 'add_node',
          type: 'text',
          text: 'Red',
          x: 0,
          y: 0,
          width: 200,
          height: 100,
          color: '1',
        },
      ]);
      expect(data.nodes[0].color).toBe('1');
    });

    it('throws when text node has no text field', () => {
      expect(() =>
        applyOperations(emptyCanvas(), [
          { op: 'add_node', type: 'text', x: 0, y: 0, width: 200, height: 100 },
        ])
      ).toThrow(/operation 0.*text.*required/i);
    });

    it('throws when file node has no file field', () => {
      expect(() =>
        applyOperations(emptyCanvas(), [
          { op: 'add_node', type: 'file', x: 0, y: 0, width: 200, height: 100 },
        ])
      ).toThrow(/operation 0.*file.*required/i);
    });

    it('throws when link node has no url field', () => {
      expect(() =>
        applyOperations(emptyCanvas(), [
          { op: 'add_node', type: 'link', x: 0, y: 0, width: 200, height: 100 },
        ])
      ).toThrow(/operation 0.*url.*required/i);
    });
  });

  describe('applyOperations — update_node', () => {
    it('updates position and size', () => {
      const initial = emptyCanvas();
      initial.nodes.push({
        id: 'node1',
        type: 'text',
        text: 'Hello',
        x: 0,
        y: 0,
        width: 200,
        height: 100,
      });

      const { data } = applyOperations(initial, [
        { op: 'update_node', id: 'node1', x: 50, y: 60, width: 300 },
      ]);
      expect(data.nodes[0].x).toBe(50);
      expect(data.nodes[0].y).toBe(60);
      expect(data.nodes[0].width).toBe(300);
      expect(data.nodes[0].height).toBe(100); // unchanged
    });

    it('sets and removes color via null', () => {
      const initial = emptyCanvas();
      initial.nodes.push({
        id: 'node1',
        type: 'text',
        text: 'Hello',
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        color: '3',
      });

      const { data } = applyOperations(initial, [{ op: 'update_node', id: 'node1', color: null }]);
      expect(data.nodes[0].color).toBeUndefined();
    });

    it('updates text content', () => {
      const initial = emptyCanvas();
      initial.nodes.push({
        id: 'node1',
        type: 'text',
        text: 'Old',
        x: 0,
        y: 0,
        width: 200,
        height: 100,
      });

      const { data } = applyOperations(initial, [{ op: 'update_node', id: 'node1', text: 'New' }]);
      expect(data.nodes[0].type === 'text' && data.nodes[0].text).toBe('New');
    });

    it('throws for non-existent node ID', () => {
      expect(() =>
        applyOperations(emptyCanvas(), [{ op: 'update_node', id: 'ghost', x: 10 }])
      ).toThrow(/operation 0.*node.*ghost.*not found/i);
    });
  });

  describe('applyOperations — remove_node', () => {
    it('removes a node by ID', () => {
      const initial = emptyCanvas();
      initial.nodes.push({
        id: 'node1',
        type: 'text',
        text: 'Gone',
        x: 0,
        y: 0,
        width: 200,
        height: 100,
      });

      const { data } = applyOperations(initial, [{ op: 'remove_node', id: 'node1' }]);
      expect(data.nodes).toHaveLength(0);
    });

    it('cascades removal of connected edges', () => {
      const initial: ObsidianCanvasData = {
        nodes: [
          { id: 'a', type: 'text', text: 'A', x: 0, y: 0, width: 200, height: 100 },
          { id: 'b', type: 'text', text: 'B', x: 400, y: 0, width: 200, height: 100 },
          { id: 'c', type: 'text', text: 'C', x: 800, y: 0, width: 200, height: 100 },
        ],
        edges: [
          { id: 'e1', fromNode: 'a', toNode: 'b' },
          { id: 'e2', fromNode: 'b', toNode: 'c' },
          { id: 'e3', fromNode: 'a', toNode: 'c' },
        ],
      };

      const { data } = applyOperations(initial, [{ op: 'remove_node', id: 'b' }]);
      expect(data.nodes).toHaveLength(2);
      expect(data.edges).toHaveLength(1);
      expect(data.edges[0].id).toBe('e3');
    });

    it('throws for non-existent node ID', () => {
      expect(() => applyOperations(emptyCanvas(), [{ op: 'remove_node', id: 'ghost' }])).toThrow(
        /operation 0.*node.*ghost.*not found/i
      );
    });
  });

  describe('applyOperations — add_edge', () => {
    it('adds an edge between existing nodes', () => {
      const initial: ObsidianCanvasData = {
        nodes: [
          { id: 'a', type: 'text', text: 'A', x: 0, y: 0, width: 200, height: 100 },
          { id: 'b', type: 'text', text: 'B', x: 400, y: 0, width: 200, height: 100 },
        ],
        edges: [],
      };

      const { data } = applyOperations(initial, [
        { op: 'add_edge', fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left' },
      ]);
      expect(data.edges).toHaveLength(1);
      expect(data.edges[0].fromNode).toBe('a');
      expect(data.edges[0].toNode).toBe('b');
      expect(data.edges[0].fromSide).toBe('right');
      expect(data.edges[0].toSide).toBe('left');
      expect(data.edges[0].id).toMatch(/^[0-9a-f]{16}$/);
    });

    it('resolves ref: labels to generated IDs', () => {
      const { data } = applyOperations(emptyCanvas(), [
        {
          op: 'add_node',
          ref: 'start',
          type: 'text',
          text: 'Start',
          x: 0,
          y: 0,
          width: 200,
          height: 100,
        },
        {
          op: 'add_node',
          ref: 'end',
          type: 'text',
          text: 'End',
          x: 400,
          y: 0,
          width: 200,
          height: 100,
        },
        { op: 'add_edge', fromNode: 'ref:start', toNode: 'ref:end' },
      ]);
      expect(data.edges).toHaveLength(1);
      expect(data.edges[0].fromNode).toBe(data.nodes[0].id);
      expect(data.edges[0].toNode).toBe(data.nodes[1].id);
    });

    it('applies optional color and label', () => {
      const initial: ObsidianCanvasData = {
        nodes: [
          { id: 'a', type: 'text', text: 'A', x: 0, y: 0, width: 200, height: 100 },
          { id: 'b', type: 'text', text: 'B', x: 400, y: 0, width: 200, height: 100 },
        ],
        edges: [],
      };

      const { data } = applyOperations(initial, [
        { op: 'add_edge', fromNode: 'a', toNode: 'b', color: '4', label: 'next' },
      ]);
      expect(data.edges[0].color).toBe('4');
      expect(data.edges[0].label).toBe('next');
    });

    it('throws for unknown ref label', () => {
      expect(() =>
        applyOperations(emptyCanvas(), [
          {
            op: 'add_node',
            ref: 'a',
            type: 'text',
            text: 'A',
            x: 0,
            y: 0,
            width: 200,
            height: 100,
          },
          { op: 'add_edge', fromNode: 'ref:a', toNode: 'ref:missing' },
        ])
      ).toThrow(/operation 1.*ref.*missing.*not found/i);
    });

    it('throws when fromNode does not exist', () => {
      const initial: ObsidianCanvasData = {
        nodes: [{ id: 'a', type: 'text', text: 'A', x: 0, y: 0, width: 200, height: 100 }],
        edges: [],
      };
      expect(() =>
        applyOperations(initial, [{ op: 'add_edge', fromNode: 'ghost', toNode: 'a' }])
      ).toThrow(/operation 0.*node.*ghost.*not found/i);
    });
  });

  describe('applyOperations — update_edge', () => {
    it('updates edge sides and label', () => {
      const initial: ObsidianCanvasData = {
        nodes: [
          { id: 'a', type: 'text', text: 'A', x: 0, y: 0, width: 200, height: 100 },
          { id: 'b', type: 'text', text: 'B', x: 400, y: 0, width: 200, height: 100 },
        ],
        edges: [{ id: 'e1', fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left' }],
      };

      const { data } = applyOperations(initial, [
        { op: 'update_edge', id: 'e1', fromSide: 'bottom', label: 'updated' },
      ]);
      expect(data.edges[0].fromSide).toBe('bottom');
      expect(data.edges[0].toSide).toBe('left'); // unchanged
      expect(data.edges[0].label).toBe('updated');
    });

    it('removes fields via null', () => {
      const initial: ObsidianCanvasData = {
        nodes: [
          { id: 'a', type: 'text', text: 'A', x: 0, y: 0, width: 200, height: 100 },
          { id: 'b', type: 'text', text: 'B', x: 400, y: 0, width: 200, height: 100 },
        ],
        edges: [{ id: 'e1', fromNode: 'a', toNode: 'b', color: '2', label: 'old' }],
      };

      const { data } = applyOperations(initial, [
        { op: 'update_edge', id: 'e1', color: null, label: null },
      ]);
      expect(data.edges[0].color).toBeUndefined();
      expect(data.edges[0].label).toBeUndefined();
    });

    it('throws for non-existent edge ID', () => {
      expect(() =>
        applyOperations(emptyCanvas(), [{ op: 'update_edge', id: 'ghost', label: 'x' }])
      ).toThrow(/operation 0.*edge.*ghost.*not found/i);
    });
  });

  describe('applyOperations — remove_edge', () => {
    it('removes an edge by ID', () => {
      const initial: ObsidianCanvasData = {
        nodes: [
          { id: 'a', type: 'text', text: 'A', x: 0, y: 0, width: 200, height: 100 },
          { id: 'b', type: 'text', text: 'B', x: 400, y: 0, width: 200, height: 100 },
        ],
        edges: [{ id: 'e1', fromNode: 'a', toNode: 'b' }],
      };

      const { data } = applyOperations(initial, [{ op: 'remove_edge', id: 'e1' }]);
      expect(data.edges).toHaveLength(0);
      expect(data.nodes).toHaveLength(2); // nodes untouched
    });

    it('throws for non-existent edge ID', () => {
      expect(() => applyOperations(emptyCanvas(), [{ op: 'remove_edge', id: 'ghost' }])).toThrow(
        /operation 0.*edge.*ghost.*not found/i
      );
    });
  });

  describe('applyOperations — batch', () => {
    it('builds a complete graph: 3 nodes + 2 edges in one call', () => {
      const { data, refMap } = applyOperations(emptyCanvas(), [
        {
          op: 'add_node',
          ref: 'a',
          type: 'text',
          text: 'Start',
          x: 0,
          y: 0,
          width: 200,
          height: 100,
        },
        {
          op: 'add_node',
          ref: 'b',
          type: 'text',
          text: 'Middle',
          x: 300,
          y: 0,
          width: 200,
          height: 100,
        },
        {
          op: 'add_node',
          ref: 'c',
          type: 'text',
          text: 'End',
          x: 600,
          y: 0,
          width: 200,
          height: 100,
        },
        {
          op: 'add_edge',
          fromNode: 'ref:a',
          toNode: 'ref:b',
          fromSide: 'right',
          toSide: 'left',
          label: 'step1',
        },
        {
          op: 'add_edge',
          fromNode: 'ref:b',
          toNode: 'ref:c',
          fromSide: 'right',
          toSide: 'left',
          label: 'step2',
        },
      ]);

      expect(data.nodes).toHaveLength(3);
      expect(data.edges).toHaveLength(2);
      expect(Object.keys(refMap)).toHaveLength(3);

      expect(data.edges[0].fromNode).toBe(refMap['a']);
      expect(data.edges[0].toNode).toBe(refMap['b']);
      expect(data.edges[1].fromNode).toBe(refMap['b']);
      expect(data.edges[1].toNode).toBe(refMap['c']);
    });

    it('does not mutate the input canvas', () => {
      const initial = emptyCanvas();
      Object.freeze(initial.nodes);
      Object.freeze(initial.edges);

      const { data } = applyOperations(initial, [
        { op: 'add_node', type: 'text', text: 'Hi', x: 0, y: 0, width: 200, height: 100 },
      ]);
      expect(data.nodes).toHaveLength(1);
      expect(initial.nodes).toHaveLength(0);
    });
  });

  describe('buildEmbedOperations', () => {
    it('horizontal layout: positions nodes side by side', () => {
      const ops = buildEmbedOperations({
        files: ['a.md', 'b.md', 'c.md'],
        layout: 'horizontal',
        connect: false,
        startX: 0,
        startY: 0,
        nodeWidth: 400,
        nodeHeight: 300,
        gap: 100,
      });

      const addNodes = ops.filter((o) => o.op === 'add_node');
      expect(addNodes).toHaveLength(3);
      expect(addNodes[0]).toMatchObject({ x: 0, y: 0, width: 400, height: 300, file: 'a.md' });
      expect(addNodes[1]).toMatchObject({ x: 500, y: 0 });
      expect(addNodes[2]).toMatchObject({ x: 1000, y: 0 });
    });

    it('vertical layout: positions nodes top to bottom', () => {
      const ops = buildEmbedOperations({
        files: ['a.md', 'b.md', 'c.md'],
        layout: 'vertical',
        connect: false,
        startX: 0,
        startY: 0,
        nodeWidth: 400,
        nodeHeight: 300,
        gap: 100,
      });

      const addNodes = ops.filter((o) => o.op === 'add_node');
      expect(addNodes).toHaveLength(3);
      expect(addNodes[0]).toMatchObject({ x: 0, y: 0 });
      expect(addNodes[1]).toMatchObject({ x: 0, y: 400 });
      expect(addNodes[2]).toMatchObject({ x: 0, y: 800 });
    });

    it('grid layout: arranges in 3 columns', () => {
      const ops = buildEmbedOperations({
        files: ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'],
        layout: 'grid',
        connect: false,
        startX: 0,
        startY: 0,
        nodeWidth: 400,
        nodeHeight: 300,
        gap: 100,
      });

      const addNodes = ops.filter((o) => o.op === 'add_node');
      expect(addNodes).toHaveLength(5);
      // Row 0: columns 0, 1, 2
      expect(addNodes[0]).toMatchObject({ x: 0, y: 0 });
      expect(addNodes[1]).toMatchObject({ x: 500, y: 0 });
      expect(addNodes[2]).toMatchObject({ x: 1000, y: 0 });
      // Row 1: columns 0, 1
      expect(addNodes[3]).toMatchObject({ x: 0, y: 400 });
      expect(addNodes[4]).toMatchObject({ x: 500, y: 400 });
    });

    it('connect: true adds sequential edges for horizontal', () => {
      const ops = buildEmbedOperations({
        files: ['a.md', 'b.md', 'c.md'],
        layout: 'horizontal',
        connect: true,
        startX: 0,
        startY: 0,
        nodeWidth: 400,
        nodeHeight: 300,
        gap: 100,
      });

      const addEdges = ops.filter((o) => o.op === 'add_edge');
      expect(addEdges).toHaveLength(2);
      expect(addEdges[0]).toMatchObject({
        fromNode: 'ref:file-0',
        toNode: 'ref:file-1',
        fromSide: 'right',
        toSide: 'left',
      });
      expect(addEdges[1]).toMatchObject({
        fromNode: 'ref:file-1',
        toNode: 'ref:file-2',
        fromSide: 'right',
        toSide: 'left',
      });
    });

    it('connect: true adds sequential edges for vertical', () => {
      const ops = buildEmbedOperations({
        files: ['a.md', 'b.md', 'c.md'],
        layout: 'vertical',
        connect: true,
        startX: 0,
        startY: 0,
        nodeWidth: 400,
        nodeHeight: 300,
        gap: 100,
      });

      const addEdges = ops.filter((o) => o.op === 'add_edge');
      expect(addEdges).toHaveLength(2);
      expect(addEdges[0]).toMatchObject({ fromSide: 'bottom', toSide: 'top' });
      expect(addEdges[1]).toMatchObject({ fromSide: 'bottom', toSide: 'top' });
    });

    it('connect: true with grid does not add edges', () => {
      const ops = buildEmbedOperations({
        files: ['a.md', 'b.md', 'c.md'],
        layout: 'grid',
        connect: true,
        startX: 0,
        startY: 0,
        nodeWidth: 400,
        nodeHeight: 300,
        gap: 100,
      });

      const addEdges = ops.filter((o) => o.op === 'add_edge');
      expect(addEdges).toHaveLength(0);
    });

    it('respects custom startX/startY/gap/nodeWidth/nodeHeight', () => {
      const ops = buildEmbedOperations({
        files: ['a.md', 'b.md'],
        layout: 'horizontal',
        connect: false,
        startX: 100,
        startY: 200,
        nodeWidth: 500,
        nodeHeight: 400,
        gap: 50,
      });

      const addNodes = ops.filter((o) => o.op === 'add_node');
      expect(addNodes[0]).toMatchObject({ x: 100, y: 200, width: 500, height: 400 });
      expect(addNodes[1]).toMatchObject({ x: 650, y: 200 });
    });

    it('single file: no edges even with connect true', () => {
      const ops = buildEmbedOperations({
        files: ['only.md'],
        layout: 'horizontal',
        connect: true,
        startX: 0,
        startY: 0,
        nodeWidth: 400,
        nodeHeight: 300,
        gap: 100,
      });

      const addNodes = ops.filter((o) => o.op === 'add_node');
      const addEdges = ops.filter((o) => o.op === 'add_edge');
      expect(addNodes).toHaveLength(1);
      expect(addEdges).toHaveLength(0);
    });

    it('applies color to all nodes when color is set', () => {
      const ops = buildEmbedOperations({
        files: ['a.md', 'b.md', 'c.md'],
        layout: 'horizontal',
        connect: false,
        startX: 0,
        startY: 0,
        nodeWidth: 400,
        nodeHeight: 300,
        gap: 100,
        color: '4',
      });

      const addNodes = ops.filter((o) => o.op === 'add_node');
      expect(addNodes).toHaveLength(3);
      for (const node of addNodes) {
        expect(node).toHaveProperty('color', '4');
      }
    });

    it('omits color when not provided', () => {
      const ops = buildEmbedOperations({
        files: ['a.md', 'b.md'],
        layout: 'horizontal',
        connect: false,
        startX: 0,
        startY: 0,
        nodeWidth: 400,
        nodeHeight: 300,
        gap: 100,
      });

      const addNodes = ops.filter((o) => o.op === 'add_node');
      expect(addNodes).toHaveLength(2);
      for (const node of addNodes) {
        expect(node).not.toHaveProperty('color');
      }
    });

    it('embeds files and connects them end-to-end (integration)', () => {
      const ops = buildEmbedOperations({
        files: ['doc/a.md', 'doc/b.md', 'doc/c.md'],
        layout: 'horizontal',
        connect: true,
        startX: 0,
        startY: 0,
        nodeWidth: 400,
        nodeHeight: 300,
        gap: 100,
      });

      const { data } = applyOperations(emptyCanvas(), ops);
      expect(data.nodes).toHaveLength(3);
      expect(data.edges).toHaveLength(2);

      // Verify nodes are file type with correct paths
      expect(data.nodes[0].type === 'file' && data.nodes[0].file).toBe('doc/a.md');
      expect(data.nodes[1].type === 'file' && data.nodes[1].file).toBe('doc/b.md');
      expect(data.nodes[2].type === 'file' && data.nodes[2].file).toBe('doc/c.md');

      // Verify edges connect sequentially
      expect(data.edges[0].fromNode).toBe(data.nodes[0].id);
      expect(data.edges[0].toNode).toBe(data.nodes[1].id);
      expect(data.edges[1].fromNode).toBe(data.nodes[1].id);
      expect(data.edges[1].toNode).toBe(data.nodes[2].id);
    });
  });

  describe('assertWithinProject', () => {
    it('accepts a path within the project', () => {
      const result = assertWithinProject('/project', '/project/notes/test.canvas');
      expect(result).toBe('/project/notes/test.canvas');
    });

    it('rejects a path outside the project', () => {
      expect(() => assertWithinProject('/project', '/etc/passwd')).toThrow(
        /outside the project root/
      );
    });

    it('rejects path traversal via ../', () => {
      expect(() => assertWithinProject('/project', '/project/../etc/passwd')).toThrow(
        /outside the project root/
      );
    });

    it('rejects the project root itself without trailing path', () => {
      // The root directory itself is accepted (it's not outside)
      const result = assertWithinProject('/project', '/project');
      expect(result).toBe('/project');
    });

    it('rejects a sibling directory with similar prefix', () => {
      expect(() => assertWithinProject('/project', '/project-other/file.canvas')).toThrow(
        /outside the project root/
      );
    });
  });
});
