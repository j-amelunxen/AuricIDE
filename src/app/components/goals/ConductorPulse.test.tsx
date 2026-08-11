import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConductorPulse } from './ConductorPulse';
import { useStore } from '@/lib/store';

describe('ConductorPulse', () => {
  beforeEach(() => {
    useStore.setState({
      conductorRunning: false,
      conductorAssignments: {},
      conductorPendingApprovals: [],
      goalsModalOpen: false,
    });
  });

  it('renders an idle conductor organ when stopped', () => {
    render(<ConductorPulse />);
    const pulse = screen.getByTestId('conductor-pulse');
    expect(pulse).toHaveTextContent('Conductor');
    expect(pulse).toHaveTextContent('idle');
  });

  it('shows the number of working agents while running', () => {
    useStore.setState({
      conductorRunning: true,
      conductorAssignments: { t1: 'a1', t2: 'a2', t3: 'a3' },
    });
    render(<ConductorPulse />);
    expect(screen.getByTestId('conductor-pulse')).toHaveTextContent('3 working');
  });

  it('pulses while running', () => {
    useStore.setState({ conductorRunning: true });
    render(<ConductorPulse />);
    expect(screen.getByTestId('conductor-pulse-dot')).toHaveClass('animate-pulse');
  });

  it('does not pulse while stopped', () => {
    render(<ConductorPulse />);
    expect(screen.getByTestId('conductor-pulse-dot')).not.toHaveClass('animate-pulse');
  });

  it('surfaces pending approvals as "need you"', () => {
    useStore.setState({ conductorRunning: true, conductorPendingApprovals: ['t1'] });
    render(<ConductorPulse />);
    expect(screen.getByTestId('conductor-pulse')).toHaveTextContent('1 need you');
  });

  it('opens Goals & Orchestration when clicked', () => {
    render(<ConductorPulse />);
    fireEvent.click(screen.getByTestId('conductor-pulse'));
    expect(useStore.getState().goalsModalOpen).toBe(true);
  });

  it('is reachable by an accessible label', () => {
    render(<ConductorPulse />);
    expect(screen.getByRole('button', { name: 'Conductor status' })).toBeInTheDocument();
  });
});
