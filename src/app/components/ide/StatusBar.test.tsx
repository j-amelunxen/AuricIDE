import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatusBar } from './StatusBar';

describe('StatusBar', () => {
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
});
