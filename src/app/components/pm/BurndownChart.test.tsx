import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BurndownChart } from './BurndownChart';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: (props: Record<string, unknown>) => <div data-testid={`line-${props.dataKey}`} />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
}));

describe('BurndownChart', () => {
  it('shows empty message when data is empty', () => {
    render(<BurndownChart data={[]} />);
    expect(screen.getByText('No burndown data available')).toBeDefined();
  });

  it('renders chart when data is provided', () => {
    const data = [
      { date: '2026-01-01', remaining: 10, completed: 0 },
      { date: '2026-01-02', remaining: 8, completed: 2 },
    ];
    render(<BurndownChart data={data} />);
    expect(screen.getByTestId('line-chart')).toBeDefined();
    expect(screen.getByTestId('line-remaining')).toBeDefined();
    expect(screen.getByTestId('line-completed')).toBeDefined();
  });

  it('does not render chart elements when data is empty', () => {
    render(<BurndownChart data={[]} />);
    expect(screen.queryByTestId('line-chart')).toBeNull();
  });
});
