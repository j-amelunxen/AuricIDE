import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, sep, dirname } from 'node:path';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import {
  parseObsidianCanvas,
  serializeObsidianCanvas,
} from '../../lib/obsidian-canvas/canvasParser';
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

const ObsidianSideSchema = z.enum(['top', 'bottom', 'left', 'right']);
const ObsidianColorSchema = z.enum(['1', '2', '3', '4', '5', '6']);

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

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

export function assertWithinProject(projectRoot: string, filePath: string): string {
  const resolved = resolve(filePath);
  const root = resolve(projectRoot);
  if (!resolved.startsWith(root + sep) && resolved !== root) {
    throw new Error(`Path "${filePath}" is outside the project root`);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

async function readCanvasFile(filePath: string): Promise<ObsidianCanvasData> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return parseObsidianCanvas(content);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { nodes: [], edges: [] };
    }
    throw err;
  }
}

async function writeCanvasFile(filePath: string, data: ObsidianCanvasData): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, serializeObsidianCanvas(data), 'utf-8');
}

// ---------------------------------------------------------------------------
// MCP tool registration
// ---------------------------------------------------------------------------

export function registerCanvasTools(server: FastMCP, projectRoot: string): void {
  server.addTool({
    name: 'canvas_read',
    description:
      'Read and parse an Obsidian Canvas (.canvas) file. Returns all nodes and edges ' +
      'with their full properties. Use this before modifying a canvas to understand ' +
      'its current structure — node IDs, positions, connections, and content.',
    parameters: z.object({
      filePath: z.string().describe('Absolute path to the .canvas file'),
    }),
    execute: async ({ filePath }) => {
      const safePath = assertWithinProject(projectRoot, filePath);
      const data = await readCanvasFile(safePath);
      const nodeTypes: Record<string, number> = {};
      for (const node of data.nodes) {
        nodeTypes[node.type] = (nodeTypes[node.type] ?? 0) + 1;
      }
      return JSON.stringify(
        {
          nodes: data.nodes,
          edges: data.edges,
          summary: {
            nodeCount: data.nodes.length,
            edgeCount: data.edges.length,
            nodeTypes,
          },
        },
        null,
        2
      );
    },
  });

  server.addTool({
    name: 'canvas_write',
    description:
      'Apply a batch of operations to an Obsidian Canvas (.canvas) file. Operations ' +
      'are executed sequentially and atomically — if any operation fails, no changes ' +
      'are written. The file is created automatically if it does not exist.\n\n' +
      'OPERATIONS (set via the "op" field):\n' +
      '- add_node:    Create a node. Types: "text" (needs text), "file" (needs file),\n' +
      '               "link" (needs url), "group" (optional label/background).\n' +
      '               All need x, y, width, height. Color is optional (1-6).\n' +
      '               IDs are auto-generated. Use "ref" to label a node for edges.\n' +
      '- update_node: Partial update by ID. Only provided fields change.\n' +
      '               Set a field to null to remove it (e.g. color: null).\n' +
      '- remove_node: Delete a node by ID. Connected edges are removed too.\n' +
      '- add_edge:    Connect two nodes. fromNode/toNode accept node IDs or\n' +
      '               "ref:<label>" to reference nodes created in the same batch.\n' +
      '               Optional: fromSide/toSide (top/bottom/left/right), color, label.\n' +
      '- update_edge: Partial update by ID (sides, color, label).\n' +
      '- remove_edge: Delete an edge by ID.\n\n' +
      'REF SYSTEM — build a complete graph in one call:\n' +
      'Set "ref" on add_node, then use "ref:<label>" in add_edge\'s fromNode/toNode:\n' +
      '  [\n' +
      '    {"op":"add_node","ref":"a","type":"text","text":"Start","x":0,"y":0,"width":200,"height":100},\n' +
      '    {"op":"add_node","ref":"b","type":"text","text":"End","x":400,"y":0,"width":200,"height":100},\n' +
      '    {"op":"add_edge","fromNode":"ref:a","toNode":"ref:b","fromSide":"right","toSide":"left"}\n' +
      '  ]\n\n' +
      'FILE EMBEDDING EXAMPLE — embed markdown files and connect them:\n' +
      '  [\n' +
      '    {"op":"add_node","ref":"spec","type":"file","file":"docs/spec.md","x":0,"y":0,"width":400,"height":300},\n' +
      '    {"op":"add_node","ref":"impl","type":"file","file":"src/feature.ts","x":500,"y":0,"width":400,"height":300},\n' +
      '    {"op":"add_edge","fromNode":"ref:spec","toNode":"ref:impl","fromSide":"right","toSide":"left","label":"implements"}\n' +
      '  ]\n\n' +
      'COLORS: 1=red, 2=orange, 3=yellow, 4=green, 5=teal, 6=purple.\n' +
      'Returns the full updated canvas and a refs map (label → generated ID).',
    parameters: z.object({
      filePath: z.string().describe('Absolute path to the .canvas file'),
      operations: z.array(CanvasOperationSchema).describe('Ordered list of operations to apply'),
    }),
    execute: async ({ filePath, operations }) => {
      const safePath = assertWithinProject(projectRoot, filePath);
      const existing = await readCanvasFile(safePath);
      const { data, refMap } = applyOperations(existing, operations);
      await writeCanvasFile(safePath, data);

      const nodeTypes: Record<string, number> = {};
      for (const node of data.nodes) {
        nodeTypes[node.type] = (nodeTypes[node.type] ?? 0) + 1;
      }

      return JSON.stringify(
        {
          canvas: { nodes: data.nodes, edges: data.edges },
          refs: refMap,
          summary: {
            nodeCount: data.nodes.length,
            edgeCount: data.edges.length,
            nodeTypes,
            operationsApplied: operations.length,
          },
        },
        null,
        2
      );
    },
  });

  server.addTool({
    name: 'canvas_embed_files',
    description:
      'Batch-embed multiple files as nodes on an Obsidian Canvas with automatic layout. ' +
      'Optionally connect them sequentially with edges. This is a convenience wrapper ' +
      'around canvas_write for the common case of placing several file references on a canvas.\n\n' +
      'LAYOUTS:\n' +
      '- horizontal: nodes placed left to right in a single row\n' +
      '- vertical: nodes placed top to bottom in a single column\n' +
      '- grid: nodes arranged in rows of 3 columns (no edges even if connect=true)',
    parameters: z.object({
      canvasPath: z.string().describe('Absolute path to the .canvas file (created if missing)'),
      files: z.array(z.string()).min(1).describe('Relative file paths to embed as file nodes'),
      layout: z
        .enum(['horizontal', 'vertical', 'grid'])
        .default('horizontal')
        .describe('How to arrange the nodes'),
      connect: z
        .boolean()
        .default(false)
        .describe('If true, connect nodes sequentially with edges (left→right or top→bottom)'),
      startX: z.number().default(0).describe('X offset for first node'),
      startY: z.number().default(0).describe('Y offset for first node'),
      nodeWidth: z.number().default(400).describe('Width of each file node'),
      nodeHeight: z.number().default(300).describe('Height of each file node'),
      gap: z.number().default(100).describe('Gap between nodes'),
      color: ObsidianColorSchema.optional().describe(
        'Color for all embedded nodes (1=red, 2=orange, 3=yellow, 4=green, 5=teal, 6=purple)'
      ),
    }),
    execute: async ({
      canvasPath,
      files,
      layout,
      connect,
      startX,
      startY,
      nodeWidth,
      nodeHeight,
      gap,
      color,
    }) => {
      const safeCanvasPath = assertWithinProject(projectRoot, canvasPath);
      const existing = await readCanvasFile(safeCanvasPath);
      const ops = buildEmbedOperations({
        files,
        layout,
        connect,
        startX,
        startY,
        nodeWidth,
        nodeHeight,
        gap,
        color,
      });
      const { data, refMap } = applyOperations(existing, ops);
      await writeCanvasFile(safeCanvasPath, data);

      const nodeTypes: Record<string, number> = {};
      for (const node of data.nodes) {
        nodeTypes[node.type] = (nodeTypes[node.type] ?? 0) + 1;
      }

      return JSON.stringify(
        {
          canvas: { nodes: data.nodes, edges: data.edges },
          refs: refMap,
          summary: {
            nodeCount: data.nodes.length,
            edgeCount: data.edges.length,
            nodeTypes,
            filesEmbedded: files.length,
            layout,
          },
        },
        null,
        2
      );
    },
  });
}
