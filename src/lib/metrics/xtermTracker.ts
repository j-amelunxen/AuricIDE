let instanceCount = 0;

export function xtermMounted(): void {
  instanceCount++;
}

export function xtermUnmounted(): void {
  instanceCount = Math.max(0, instanceCount - 1);
}

export function getXtermCount(): number {
  return instanceCount;
}

export function resetXtermCount(): void {
  instanceCount = 0;
}
