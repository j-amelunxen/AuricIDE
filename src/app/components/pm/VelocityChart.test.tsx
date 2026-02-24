import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VelocityChart } from './VelocityChart';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: (props: Record<string, unknown>) => <div data-testid={`bar-${props.dataKey}`} />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
}));

describe('VelocityChart', () => {
  it('shows empty message when data is empty', () => {
    render(<VelocityChart data={[]} />);
    expect(screen.getByText('No velocity data available')).toBeDefined();
  });

  it('renders chart when data is provided', () => {
    const data = [
      { periodStart: '2026-01-01', periodEnd: '2026-01-07', completed: 5 },
      { periodStart: '2026-01-08', periodEnd: '2026-01-14', completed: 3 },
    ];
    render(<VelocityChart data={data} />);
    expect(screen.getByTestId('bar-chart')).toBeDefined();
    expect(screen.getByTestId('bar-completed')).toBeDefined();
  });

  it('does not render chart elements when data is empty', () => {
    render(<VelocityChart data={[]} />);
    expect(screen.queryByTestId('bar-chart')).toBeNull();
  });
});
