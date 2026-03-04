export type ObsidianSide = 'top' | 'bottom' | 'left' | 'right';
export type ObsidianColor = '1' | '2' | '3' | '4' | '5' | '6';

export interface ObsidianNodeBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: ObsidianColor;
  auricTicketId?: string;
}

export interface ObsidianTextNode extends ObsidianNodeBase {
  type: 'text';
  text: string;
}

export interface ObsidianFileNode extends ObsidianNodeBase {
  type: 'file';
  file: string;
}

export interface ObsidianLinkNode extends ObsidianNodeBase {
  type: 'link';
  url: string;
}

export interface ObsidianGroupNode extends ObsidianNodeBase {
  type: 'group';
  label?: string;
  background?: string;
}

export type ObsidianNode =
  | ObsidianTextNode
  | ObsidianFileNode
  | ObsidianLinkNode
  | ObsidianGroupNode;

export interface ObsidianEdge {
  id: string;
  fromNode: string;
  fromSide?: ObsidianSide;
  toNode: string;
  toSide?: ObsidianSide;
  color?: ObsidianColor;
  label?: string;
}

export interface ObsidianCanvasData {
  nodes: ObsidianNode[];
  edges: ObsidianEdge[];
}
