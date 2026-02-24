import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FlowchartNode, type FlowchartNodeData } from './FlowchartNode';

vi.mock('@xyflow/react', () => ({
  Handle: ({ type, position, ...props }: Record<string, unknown>) => (
    <div data-testid={`handle-${type}`} data-position={position} {...props} />
  ),
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}));

function renderFlowchartNode(overrides: Partial<FlowchartNodeData> = {}) {
  const defaultData: FlowchartNodeData = {
    label: 'Test Node',
    shape: 'rect',
    direction: 'TD',
    onEdit: vi.fn(),
    ...overrides,
  };
  const defaultProps = {
    id: 'test-node',
    type: 'flowchart' as const,
    data: defaultData,
    selected: false,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ...render(<FlowchartNode {...(defaultProps as any)} />), data: defaultData };
}

describe('FlowchartNode', () => {
  it('renders label text correctly', () => {
    renderFlowchartNode({ label: 'Hello World' });
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('double-click activates inline edit mode with input', () => {
    const { container } = renderFlowchartNode();
    fireEvent.doubleClick(container.firstElementChild as HTMLElement);
    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('Test Node');
  });

  it('blur commits edit and calls onEdit with new label', () => {
    const onEdit = vi.fn();
    const { container } = renderFlowchartNode({ label: 'Original', onEdit });
    fireEvent.doubleClick(container.firstElementChild as HTMLElement);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Updated' } });
    fireEvent.blur(input);
    expect(onEdit).toHaveBeenCalledWith('test-node', 'Updated');
  });

  it('blur without change does NOT call onEdit', () => {
    const onEdit = vi.fn();
    const { container } = renderFlowchartNode({ label: 'Original', onEdit });
    fireEvent.doubleClick(container.firstElementChild as HTMLElement);
    fireEvent.blur(screen.getByRole('textbox'));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('Escape cancels edit without calling onEdit', () => {
    const onEdit = vi.fn();
    const { container } = renderFlowchartNode({ label: 'Original', onEdit });
    fireEvent.doubleClick(container.firstElementChild as HTMLElement);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Changed' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('Enter key commits edit', () => {
    const onEdit = vi.fn();
    const { container } = renderFlowchartNode({ label: 'Original', onEdit });
    fireEvent.doubleClick(container.firstElementChild as HTMLElement);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Enter Edit' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledWith('test-node', 'Enter Edit');
  });

  it('has target and source handles', () => {
    renderFlowchartNode();
    expect(screen.getByTestId('handle-target')).toBeInTheDocument();
    expect(screen.getByTestId('handle-source')).toBeInTheDocument();
  });

  it('handle positions correct for TD direction (target=top, source=bottom)', () => {
    renderFlowchartNode({ direction: 'TD' });
    expect(screen.getByTestId('handle-target')).toHaveAttribute('data-position', 'top');
    expect(screen.getByTestId('handle-source')).toHaveAttribute('data-position', 'bottom');
  });

  it('handle positions correct for LR direction (target=left, source=right)', () => {
    renderFlowchartNode({ direction: 'LR' });
    expect(screen.getByTestId('handle-target')).toHaveAttribute('data-position', 'left');
    expect(screen.getByTestId('handle-source')).toHaveAttribute('data-position', 'right');
  });

  it('handle positions correct for BT direction (target=bottom, source=top)', () => {
    renderFlowchartNode({ direction: 'BT' });
    expect(screen.getByTestId('handle-target')).toHaveAttribute('data-position', 'bottom');
    expect(screen.getByTestId('handle-source')).toHaveAttribute('data-position', 'top');
  });

  it('handle positions correct for RL direction (target=right, source=left)', () => {
    renderFlowchartNode({ direction: 'RL' });
    expect(screen.getByTestId('handle-target')).toHaveAttribute('data-position', 'right');
    expect(screen.getByTestId('handle-source')).toHaveAttribute('data-position', 'left');
  });

  it('applies correct shape class for rect shape', () => {
    const { container } = renderFlowchartNode({ shape: 'rect' });
    expect(container.firstElementChild!.className).toContain('flowchart-node-rect');
  });

  it('applies correct shape class for rhombus shape', () => {
    const { container } = renderFlowchartNode({ shape: 'rhombus' });
    expect(container.firstElementChild!.className).toContain('flowchart-node-rhombus');
  });

  it('applies correct shape class for circle shape', () => {
    const { container } = renderFlowchartNode({ shape: 'circle' });
    expect(container.firstElementChild!.className).toContain('flowchart-node-circle');
  });

  it('applies correct shape class for round shape', () => {
    const { container } = renderFlowchartNode({ shape: 'round' });
    expect(container.firstElementChild!.className).toContain('flowchart-node-round');
  });

  it('applies correct shape class for stadium shape', () => {
    const { container } = renderFlowchartNode({ shape: 'stadium' });
    expect(container.firstElementChild!.className).toContain('flowchart-node-stadium');
  });

  it('applies correct shape class for subroutine shape', () => {
    const { container } = renderFlowchartNode({ shape: 'subroutine' });
    expect(container.firstElementChild!.className).toContain('flowchart-node-subroutine');
  });

  it('applies correct shape class for hexagon shape', () => {
    const { container } = renderFlowchartNode({ shape: 'hexagon' });
    expect(container.firstElementChild!.className).toContain('flowchart-node-hexagon');
  });

  it('applies correct shape class for asymmetric shape', () => {
    const { container } = renderFlowchartNode({ shape: 'asymmetric' });
    expect(container.firstElementChild!.className).toContain('flowchart-node-asymmetric');
  });

  it('applies correct shape class for cylindrical shape', () => {
    const { container } = renderFlowchartNode({ shape: 'cylindrical' });
    expect(container.firstElementChild!.className).toContain('flowchart-node-cylindrical');
  });

  it('applies correct shape class for double-circle shape', () => {
    const { container } = renderFlowchartNode({ shape: 'double-circle' });
    expect(container.firstElementChild!.className).toContain('flowchart-node-double-circle');
  });

  it('applies default shape class for unknown shape', () => {
    const { container } = renderFlowchartNode({ shape: 'default' });
    expect(container.firstElementChild!.className).toContain('flowchart-node-rect');
  });

  it('rhombus shape has inner text wrapper with counter-rotation', () => {
    const { container } = renderFlowchartNode({ shape: 'rhombus' });
    const inner = container.querySelector('.flowchart-node-rhombus-inner');
    expect(inner).toBeInTheDocument();
  });
});
