import { z } from 'zod';
import type {
  ObsidianCanvasData,
  ObsidianColor,
  ObsidianEdge,
  ObsidianNode,
  ObsidianSide,
} from '../../lib/obsidian-canvas/types';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const ObsidianSideSchema = z.enum(['top', 'bottom', 'left', 'right']);
export const ObsidianColorSchema = z.enum(['1', '2', '3', '4', '5', '6']);

const AddNodeOp = z.object({
  op: z.literal('add_node'),
  ref: z.string().optional().describe('Temp label for batch refs via "ref:<label>"'),
  type: z.enum(['text', 'file', 'link', 'group']),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  color: ObsidianColorSchema.optional(),
  text: z.string().optional().describe('Required for type "text"'),
  file: z.string().optional().describe('Required for type "file"'),
  url: z.string().optional().describe('Required for type "link"'),
  label: z.string().optional().describe('Optional for type "group"'),
  background: z.string().optional().describe('Optional for type "group"'),
});

const UpdateNodeOp = z.object({
  op: z.literal('update_node'),
  id: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  color: ObsidianColorSchema.nullable().optional(),
  text: z.string().optional(),
  file: z.string().optional(),
  url: z.string().optional(),
  label: z.string().nullable().optional(),
  background: z.string().nullable().optional(),
});

const RemoveNodeOp = z.object({
  op: z.literal('remove_node'),
  id: z.string(),
});

const AddEdgeOp = z.object({
  op: z.literal('add_edge'),
  fromNode: z.string().describe('Node ID or "ref:<label>"'),
  toNode: z.string().describe('Node ID or "ref:<label>"'),
  fromSide: ObsidianSideSchema.optional(),
  toSide: ObsidianSideSchema.optional(),
  color: ObsidianColorSchema.optional(),
  label: z.string().optional(),
});

const UpdateEdgeOp = z.object({
  op: z.literal('update_edge'),
  id: z.string(),
  fromSide: ObsidianSideSchema.nullable().optional(),
  toSide: ObsidianSideSchema.nullable().optional(),
  color: ObsidianColorSchema.nullable().optional(),
  label: z.string().nullable().optional(),
});

const RemoveEdgeOp = z.object({
  op: z.literal('remove_edge'),
  id: z.string(),
});

export const CanvasOperationSchema = z.discriminatedUnion('op', [
  AddNodeOp,
  UpdateNodeOp,
  RemoveNodeOp,
  AddEdgeOp,
  UpdateEdgeOp,
  RemoveEdgeOp,
]);

export type CanvasOperation = z.infer<typeof CanvasOperationSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function generateCanvasId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function resolveRef(raw: string, refMap: Record<string, string>, opIndex: number): string {
  if (!raw.startsWith('ref:')) return raw;
  const label = raw.slice(4);
  const id = refMap[label];
  if (!id) throw new Error(`Operation ${opIndex}: ref "${label}" not found`);
  return id;
}

export function countNodeTypes(nodes: ObsidianNode[]): Record<string, number> {
  const nodeTypes: Record<string, number> = {};
  for (const node of nodes) {
    nodeTypes[node.type] = (nodeTypes[node.type] ?? 0) + 1;
  }
  return nodeTypes;
}

// ---------------------------------------------------------------------------
// Core pure function
// ---------------------------------------------------------------------------

export function applyOperations(
  input: ObsidianCanvasData,
  operations: CanvasOperation[]
): { data: ObsidianCanvasData; refMap: Record<string, string> } {
  const nodes: ObsidianNode[] = [...input.nodes];
  const edges: ObsidianEdge[] = [...input.edges];
  const refMap: Record<string, string> = {};

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];

    switch (op.op) {
      case 'add_node': {
        const id = generateCanvasId();
        if (op.ref) refMap[op.ref] = id;

        const base = {
          id,
          x: op.x,
          y: op.y,
          width: op.width,
          height: op.height,
          ...(op.color ? { color: op.color as ObsidianColor } : {}),
        };

        switch (op.type) {
          case 'text': {
            if (op.text === undefined)
              throw new Error(`Operation ${i}: "text" field is required for type "text"`);
            nodes.push({ ...base, type: 'text', text: op.text });
            break;
          }
          case 'file': {
            if (op.file === undefined)
              throw new Error(`Operation ${i}: "file" field is required for type "file"`);
            nodes.push({ ...base, type: 'file', file: op.file });
            break;
          }
          case 'link': {
            if (op.url === undefined)
              throw new Error(`Operation ${i}: "url" field is required for type "link"`);
            nodes.push({ ...base, type: 'link', url: op.url });
            break;
          }
          case 'group': {
            nodes.push({
              ...base,
              type: 'group',
              ...(op.label !== undefined ? { label: op.label } : {}),
              ...(op.background !== undefined ? { background: op.background } : {}),
            });
            break;
          }
        }
        break;
      }

      case 'update_node': {
        const idx = nodes.findIndex((n) => n.id === op.id);
        if (idx === -1) throw new Error(`Operation ${i}: node "${op.id}" not found`);
        const node = { ...nodes[idx] };

        if (op.x !== undefined) node.x = op.x;
        if (op.y !== undefined) node.y = op.y;
        if (op.width !== undefined) node.width = op.width;
        if (op.height !== undefined) node.height = op.height;

        if (op.color === null) {
          delete node.color;
        } else if (op.color !== undefined) {
          node.color = op.color as ObsidianColor;
        }

        if (op.text !== undefined && node.type === 'text') node.text = op.text;
        if (op.file !== undefined && node.type === 'file') node.file = op.file;
        if (op.url !== undefined && node.type === 'link') node.url = op.url;

        if (node.type === 'group') {
          if (op.label === null) delete node.label;
          else if (op.label !== undefined) node.label = op.label;

          if (op.background === null) delete node.background;
          else if (op.background !== undefined) node.background = op.background;
        }

        nodes[idx] = node;
        break;
      }

      case 'remove_node': {
        const idx = nodes.findIndex((n) => n.id === op.id);
        if (idx === -1) throw new Error(`Operation ${i}: node "${op.id}" not found`);
        nodes.splice(idx, 1);
        // Cascade: remove connected edges
        for (let e = edges.length - 1; e >= 0; e--) {
          if (edges[e].fromNode === op.id || edges[e].toNode === op.id) {
            edges.splice(e, 1);
          }
        }
        break;
      }

      case 'add_edge': {
        const fromNode = resolveRef(op.fromNode, refMap, i);
        const toNode = resolveRef(op.toNode, refMap, i);

        if (!nodes.some((n) => n.id === fromNode))
          throw new Error(`Operation ${i}: node "${fromNode}" not found (fromNode)`);
        if (!nodes.some((n) => n.id === toNode))
          throw new Error(`Operation ${i}: node "${toNode}" not found (toNode)`);

        const edge: ObsidianEdge = {
          id: generateCanvasId(),
          fromNode,
          toNode,
          ...(op.fromSide ? { fromSide: op.fromSide as ObsidianSide } : {}),
          ...(op.toSide ? { toSide: op.toSide as ObsidianSide } : {}),
          ...(op.color ? { color: op.color as ObsidianColor } : {}),
          ...(op.label !== undefined ? { label: op.label } : {}),
        };
        edges.push(edge);
        break;
      }

      case 'update_edge': {
        const idx = edges.findIndex((e) => e.id === op.id);
        if (idx === -1) throw new Error(`Operation ${i}: edge "${op.id}" not found`);
        const edge = { ...edges[idx] };

        if (op.fromSide === null) delete edge.fromSide;
        else if (op.fromSide !== undefined) edge.fromSide = op.fromSide as ObsidianSide;

        if (op.toSide === null) delete edge.toSide;
        else if (op.toSide !== undefined) edge.toSide = op.toSide as ObsidianSide;

        if (op.color === null) delete edge.color;
        else if (op.color !== undefined) edge.color = op.color as ObsidianColor;

        if (op.label === null) delete edge.label;
        else if (op.label !== undefined) edge.label = op.label;

        edges[idx] = edge;
        break;
      }

      case 'remove_edge': {
        const idx = edges.findIndex((e) => e.id === op.id);
        if (idx === -1) throw new Error(`Operation ${i}: edge "${op.id}" not found`);
        edges.splice(idx, 1);
        break;
      }
    }
  }

  return { data: { nodes, edges }, refMap };
}

// ---------------------------------------------------------------------------
// Embed helper
// ---------------------------------------------------------------------------

export interface EmbedOptions {
  files: string[];
  layout: 'horizontal' | 'vertical' | 'grid';
  connect: boolean;
  startX: number;
  startY: number;
  nodeWidth: number;
  nodeHeight: number;
  gap: number;
  color?: '1' | '2' | '3' | '4' | '5' | '6';
}

export function buildEmbedOperations(opts: EmbedOptions): CanvasOperation[] {
  const { files, layout, connect, startX, startY, nodeWidth, nodeHeight, gap, color } = opts;
  const ops: CanvasOperation[] = [];

  for (let i = 0; i < files.length; i++) {
    let x: number;
    let y: number;

    switch (layout) {
      case 'horizontal':
        x = startX + i * (nodeWidth + gap);
        y = startY;
        break;
      case 'vertical':
        x = startX;
        y = startY + i * (nodeHeight + gap);
        break;
      case 'grid': {
        const col = i % 3;
        const row = Math.floor(i / 3);
        x = startX + col * (nodeWidth + gap);
        y = startY + row * (nodeHeight + gap);
        break;
      }
    }

    ops.push({
      op: 'add_node',
      ref: `file-${i}`,
      type: 'file',
      file: files[i],
      x,
      y,
      width: nodeWidth,
      height: nodeHeight,
      ...(color ? { color } : {}),
    });
  }

  if (connect && layout !== 'grid' && files.length > 1) {
    const [fromSide, toSide]: [ObsidianSide, ObsidianSide] =
      layout === 'horizontal' ? ['right', 'left'] : ['bottom', 'top'];

    for (let i = 0; i < files.length - 1; i++) {
      ops.push({
        op: 'add_edge',
        fromNode: `ref:file-${i}`,
        toNode: `ref:file-${i + 1}`,
        fromSide,
        toSide,
      });
    }
  }

  return ops;
}
