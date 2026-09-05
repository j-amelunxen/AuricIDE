import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, sep, dirname } from 'node:path';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import {
  parseObsidianCanvas,
  serializeObsidianCanvas,
} from '../../lib/obsidian-canvas/canvasParser';
import type { ObsidianCanvasData } from '../../lib/obsidian-canvas/types';
import {
  CanvasOperationSchema,
  ObsidianColorSchema,
  applyOperations,
  buildEmbedOperations,
  countNodeTypes,
} from './canvasOps';

export * from './canvasOps';

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
      return JSON.stringify(
        {
          nodes: data.nodes,
          edges: data.edges,
          summary: {
            nodeCount: data.nodes.length,
            edgeCount: data.edges.length,
            nodeTypes: countNodeTypes(data.nodes),
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

      return JSON.stringify(
        {
          canvas: { nodes: data.nodes, edges: data.edges },
          refs: refMap,
          summary: {
            nodeCount: data.nodes.length,
            edgeCount: data.edges.length,
            nodeTypes: countNodeTypes(data.nodes),
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

      return JSON.stringify(
        {
          canvas: { nodes: data.nodes, edges: data.edges },
          refs: refMap,
          summary: {
            nodeCount: data.nodes.length,
            edgeCount: data.edges.length,
            nodeTypes: countNodeTypes(data.nodes),
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
