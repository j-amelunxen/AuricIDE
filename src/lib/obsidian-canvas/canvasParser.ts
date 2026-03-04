import type {
  ObsidianCanvasData,
  ObsidianColor,
  ObsidianEdge,
  ObsidianNode,
  ObsidianSide,
} from './types';

export const OBSIDIAN_COLORS: Record<string, string> = {
  '1': '#fb464c',
  '2': '#e9973f',
  '3': '#e0de71',
  '4': '#44cf6e',
  '5': '#53dfdd',
  '6': '#a882ff',
};

export const DEFAULT_NODE_COLOR = '#585858';

const VALID_NODE_TYPES = new Set(['text', 'file', 'link', 'group']);
const VALID_SIDES = new Set(['top', 'bottom', 'left', 'right']);
const VALID_COLORS = new Set(['1', '2', '3', '4', '5', '6']);

type RawJson = Record<string, unknown>;

export function getObsidianColor(color: string | undefined): string {
  if (color === undefined) return DEFAULT_NODE_COLOR;
  return OBSIDIAN_COLORS[color] ?? DEFAULT_NODE_COLOR;
}

function toObsidianNode(raw: RawJson): ObsidianNode {
  const type = VALID_NODE_TYPES.has(String(raw.type)) ? String(raw.type) : 'text';
  const base = {
    id: String(raw.id ?? ''),
    x: typeof raw.x === 'number' ? raw.x : 0,
    y: typeof raw.y === 'number' ? raw.y : 0,
    width: typeof raw.width === 'number' ? raw.width : 0,
    height: typeof raw.height === 'number' ? raw.height : 0,
    ...(VALID_COLORS.has(String(raw.color)) ? { color: String(raw.color) as ObsidianColor } : {}),
    ...(typeof raw.auricTicketId === 'string' ? { auricTicketId: raw.auricTicketId } : {}),
  };

  switch (type) {
    case 'file':
      return { ...base, type: 'file', file: String(raw.file ?? '') };
    case 'link':
      return { ...base, type: 'link', url: String(raw.url ?? '') };
    case 'group':
      return {
        ...base,
        type: 'group',
        ...(raw.label !== undefined ? { label: String(raw.label) } : {}),
        ...(raw.background !== undefined ? { background: String(raw.background) } : {}),
      };
    default:
      return { ...base, type: 'text', text: String(raw.text ?? '') };
  }
}

function toObsidianEdge(raw: RawJson): ObsidianEdge {
  return {
    id: String(raw.id ?? ''),
    fromNode: String(raw.fromNode ?? ''),
    ...(VALID_SIDES.has(String(raw.fromSide))
      ? { fromSide: String(raw.fromSide) as ObsidianSide }
      : {}),
    toNode: String(raw.toNode ?? ''),
    ...(VALID_SIDES.has(String(raw.toSide)) ? { toSide: String(raw.toSide) as ObsidianSide } : {}),
    ...(VALID_COLORS.has(String(raw.color)) ? { color: String(raw.color) as ObsidianColor } : {}),
    ...(raw.label !== undefined ? { label: String(raw.label) } : {}),
  };
}

export function parseObsidianCanvas(content: string): ObsidianCanvasData {
  if (!content.trim()) {
    return { nodes: [], edges: [] };
  }

  const raw = JSON.parse(content) as RawJson;

  const rawNodes = Array.isArray(raw.nodes) ? (raw.nodes as RawJson[]) : [];
  const rawEdges = Array.isArray(raw.edges) ? (raw.edges as RawJson[]) : [];

  return {
    nodes: rawNodes.map(toObsidianNode),
    edges: rawEdges.map(toObsidianEdge),
  };
}

export function serializeObsidianCanvas(data: ObsidianCanvasData): string {
  return JSON.stringify(data, null, 2);
}
