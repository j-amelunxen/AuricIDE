import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatusBar } from './StatusBar';
import { STATUS_BAR_CLOCK_STORAGE_KEY } from '@/lib/settings/statusBarClock';
import { useStore } from '@/lib/store';

describe('StatusBar', () => {
  afterEach(() => {
    localStorage.removeItem(STATUS_BAR_CLOCK_STORAGE_KEY);
    useStore.setState({ requirementsDraft: [] });
  });

  it('renders the status bar', () => {
    render(<StatusBar />);
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
  });

  it('displays the git branch name', () => {
    render(<StatusBar branch="main" />);
    expect(screen.getByText('main')).toBeInTheDocument();
  });

  it('displays encoding', () => {
    render(<StatusBar encoding="UTF-8" />);
    expect(screen.getByText('UTF-8')).toBeInTheDocument();
  });

  it('displays language', () => {
    render(<StatusBar language="Markdown" />);
    expect(screen.getByText('Markdown')).toBeInTheDocument();
  });

  it('has glass background', () => {
    render(<StatusBar />);
    expect(screen.getByTestId('status-bar')).toHaveClass('glass');
  });

  it('has correct height', () => {
    render(<StatusBar />);
    expect(screen.getByTestId('status-bar')).toHaveClass('h-8');
  });

  it('shows slash command hint for Markdown', () => {
    render(<StatusBar language="Markdown" />);
    expect(screen.getByTestId('slash-hint')).toBeInTheDocument();
    expect(screen.getByTestId('slash-hint')).toHaveTextContent('/ commands');
  });

  it('hides slash command hint for TypeScript', () => {
    render(<StatusBar language="TypeScript" />);
    expect(screen.queryByTestId('slash-hint')).not.toBeInTheDocument();
  });

  it('hides slash command hint for JavaScript', () => {
    render(<StatusBar language="JavaScript" />);
    expect(screen.queryByTestId('slash-hint')).not.toBeInTheDocument();
  });

  it('shows problems indicator with errors', () => {
    render(<StatusBar errorCount={2} warningCount={3} />);
    expect(screen.getByTestId('problems-indicator')).toBeInTheDocument();
    expect(screen.getByText('● 2')).toBeInTheDocument();
    expect(screen.getByText('⚠ 3')).toBeInTheDocument();
  });

  it('hides problems indicator when counts are 0', () => {
    render(<StatusBar errorCount={0} warningCount={0} />);
    expect(screen.queryByTestId('problems-indicator')).not.toBeInTheDocument();
  });

  it('calls onProblemsClick when indicator is clicked', () => {
    const onClick = vi.fn();
    render(<StatusBar errorCount={1} warningCount={0} onProblemsClick={onClick} />);
    fireEvent.click(screen.getByTestId('problems-indicator'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not show an attribution credit', () => {
    render(<StatusBar />);
    expect(screen.queryByTestId('made-with-credit')).not.toBeInTheDocument();
    expect(screen.queryByText(/software-architecture\.ai/i)).not.toBeInTheDocument();
  });

  it('shows the truths light once requirements exist', () => {
    useStore.setState({
      requirementsDraft: [
        {
          id: 'r1',
          reqId: 'REQ-TEST-01',
          title: 'A truth',
          description: '',
          type: 'functional',
          category: 'test',
          priority: 'normal',
          status: 'verified',
          rationale: '',
          acceptanceCriteria: '',
          source: '',
          lastVerifiedAt: new Date().toISOString(),
          appliesTo: [],
          sortOrder: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    render(<StatusBar />);
    expect(screen.getByTestId('truths-light')).toBeInTheDocument();
  });

  it('exposes the sync status control by an accessible label', () => {
    render(<StatusBar syncStatus="syncing" />);
    expect(screen.getByRole('button', { name: 'Sync status' })).toBeInTheDocument();
  });

  it('exposes the problems indicator by an accessible label', () => {
    render(<StatusBar errorCount={2} warningCount={3} />);
    expect(screen.getByRole('button', { name: 'Problems' })).toBeInTheDocument();
  });

  it('shows the clock by default', () => {
    render(<StatusBar />);
    expect(screen.getByTestId('status-bar-clock')).toBeInTheDocument();
  });

  it('hides the clock when the setting is switched off', () => {
    localStorage.setItem(STATUS_BAR_CLOCK_STORAGE_KEY, 'false');
    render(<StatusBar />);
    expect(screen.queryByTestId('status-bar-clock')).not.toBeInTheDocument();
  });

  it('hides icon glyphs from assistive technology', () => {
    const { container } = render(<StatusBar branch="main" syncStatus="syncing" />);
    const icons = container.querySelectorAll('[data-icon]');
    expect(icons.length).toBeGreaterThan(0);
    icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'));
  });
});
