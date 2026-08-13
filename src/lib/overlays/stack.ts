export type OverlayKind = 'tool' | 'confirm';

export interface OverlayEntry {
  id: string;
  kind: OverlayKind;
}

export interface OverlayStack {
  layers: OverlayEntry[];
}

export function push(stack: OverlayStack, entry: OverlayEntry): OverlayStack {
  if (stack.layers.some((layer) => layer.id === entry.id)) {
    throw new Error(`overlay id already on stack: ${entry.id}`);
  }
  return { layers: [...stack.layers, entry] };
}

export function pop(stack: OverlayStack): OverlayStack {
  if (stack.layers.length === 0) {
    return stack;
  }
  return { layers: stack.layers.slice(0, -1) };
}

export function replace(stack: OverlayStack, entry: OverlayEntry): OverlayStack {
  const current = top(stack);
  if (current?.kind === 'confirm') {
    const withoutConfirm = pop(stack);
    if (top(withoutConfirm)?.kind !== 'tool') {
      return stack;
    }
    return push(replace(withoutConfirm, entry), current);
  }
  return push({ layers: stack.layers.slice(0, -1) }, entry);
}

export function top(stack: OverlayStack): OverlayEntry | null {
  return stack.layers[stack.layers.length - 1] ?? null;
}

export function ownsEscape(stack: OverlayStack, id: string): boolean {
  const current = top(stack);
  return current !== null && current.id === id;
}

export function hasLayer(stack: OverlayStack, id: string): boolean {
  return stack.layers.some((layer) => layer.id === id);
}

/** Drop a layer by id. Safe when the layer is not the top, or is already gone. */
export function remove(stack: OverlayStack, id: string): OverlayStack {
  if (!hasLayer(stack, id)) {
    return stack;
  }
  return { layers: stack.layers.filter((layer) => layer.id !== id) };
}
