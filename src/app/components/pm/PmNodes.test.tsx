import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { EpicNode, TicketNode } from './PmNodes';

describe('PmNodes', () => {
  describe('EpicNode', () => {
    it('renders the epic label', () => {
      const data = { label: 'My Epic' };
      render(
        <ReactFlowProvider>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <EpicNode data={data} {...({} as any)} />
        </ReactFlowProvider>
      );

      expect(screen.getByText('My Epic')).toBeDefined();
      expect(screen.getByText('Epic')).toBeDefined();
    });

    it('calls onSelect when clicked and has cursor-pointer class', () => {
      const onSelect = vi.fn();
      const data = { label: 'My Epic', onSelect };
      const { container } = render(
        <ReactFlowProvider>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <EpicNode data={data} {...({} as any)} />
        </ReactFlowProvider>
      );

      const node = container.firstChild as HTMLElement;
      expect(node.className).toContain('cursor-pointer');
      node.click();
      expect(onSelect).toHaveBeenCalled();
    });
  });

  describe('TicketNode', () => {
    it('renders the ticket label and status', () => {
      const data = { label: 'My Ticket', status: 'open' };
      render(
        <ReactFlowProvider>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <TicketNode data={data} {...({} as any)} />
        </ReactFlowProvider>
      );

      expect(screen.getByText('My Ticket')).toBeDefined();
      expect(screen.getByText('open')).toBeDefined();
    });

    it('applies correct status colors', () => {
      const { rerender } = render(
        <ReactFlowProvider>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <TicketNode data={{ label: 'T1', status: 'done' }} {...({} as any)} />
        </ReactFlowProvider>
      );
      expect(screen.getByText('done').className).toContain('text-green-400');

      rerender(
        <ReactFlowProvider>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <TicketNode data={{ label: 'T1', status: 'in_progress' }} {...({} as any)} />
        </ReactFlowProvider>
      );
      expect(screen.getByText('in_progress').className).toContain('text-blue-400');
    });

    it('renders a spawn agent button and calls onSpawnAgent', () => {
      const onSpawnAgent = vi.fn();
      const data = { label: 'My Ticket', status: 'open', onSpawnAgent };
      render(
        <ReactFlowProvider>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <TicketNode data={data} {...({} as any)} />
        </ReactFlowProvider>
      );

      const spawnBtn = screen.getByTitle('Start Agent');
      expect(spawnBtn).toBeDefined();
      spawnBtn.click();
      expect(onSpawnAgent).toHaveBeenCalled();
    });
  });
});
