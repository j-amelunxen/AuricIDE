import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Header } from './Header';

describe('Header', () => {
  it('renders the logo text', () => {
    render(<Header breadcrumbs={[]} />);
    expect(screen.getByTestId('header-logo')).toHaveTextContent('AURICIDE');
  });

  it('renders breadcrumbs', () => {
    render(<Header breadcrumbs={['Projects', 'my-project', 'README.md']} />);
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('my-project')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
  });

  it('stays quiet about the connection while everything is fine', () => {
    render(<Header breadcrumbs={[]} isConnected />);
    expect(screen.queryByTestId('connection-badge')).not.toBeInTheDocument();
  });

  it('shows disconnected status', () => {
    render(<Header breadcrumbs={[]} isConnected={false} />);
    expect(screen.getByTestId('connection-badge')).toHaveTextContent('Disconnected');
  });

  it('stays quiet about the LLM while one is configured', () => {
    render(<Header breadcrumbs={[]} llmConfigured />);
    expect(screen.queryByTestId('llm-status-badge')).not.toBeInTheDocument();
  });

  it('warns when no LLM is configured', () => {
    render(<Header breadcrumbs={[]} llmConfigured={false} />);
    expect(screen.getByTestId('llm-status-badge')).toHaveTextContent('LLM not configured');
  });

  it('renders the LLM warning as a button', () => {
    render(<Header breadcrumbs={[]} llmConfigured={false} />);
    expect(screen.getByRole('button', { name: /llm not configured/i })).toBeInTheDocument();
  });

  it('opens Settings on LLM when the status badge is clicked', async () => {
    const onOpenSettings = vi.fn();
    render(<Header breadcrumbs={[]} llmConfigured={false} onOpenSettings={onOpenSettings} />);
    await userEvent.click(screen.getByTestId('llm-status-badge'));
    expect(onOpenSettings).toHaveBeenCalledWith('llm');
  });

  it('does not wear an "AI Native" sticker', () => {
    render(<Header breadcrumbs={[]} />);
    expect(screen.queryByText('AI Native')).not.toBeInTheDocument();
  });

  it('renders the always-visible conductor pulse', () => {
    render(<Header breadcrumbs={[]} />);
    expect(screen.getByTestId('conductor-pulse')).toBeInTheDocument();
  });

  it('renders command palette trigger', () => {
    render(<Header breadcrumbs={[]} />);
    expect(screen.getByTestId('command-palette-trigger')).toBeInTheDocument();
  });

  it('labels the trigger Command Palette, not Find Agent', () => {
    render(<Header breadcrumbs={[]} />);
    const trigger = screen.getByTestId('command-palette-trigger');
    expect(trigger).toHaveTextContent(/Command Palette/);
    expect(trigger).not.toHaveTextContent(/Find Agent/);
  });

  it('applies canvas variant height', () => {
    render(<Header breadcrumbs={[]} variant="canvas" />);
    expect(screen.getByTestId('header')).toHaveClass('h-14');
  });

  it('applies editor variant height by default', () => {
    render(<Header breadcrumbs={[]} />);
    expect(screen.getByTestId('header')).toHaveClass('h-12');
  });

  it('renders heading breadcrumbs when provided', () => {
    render(
      <Header
        breadcrumbs={['AuricIDE', 'README.md']}
        headingBreadcrumbs={[
          { title: 'Introduction', lineNumber: 1 },
          { title: 'Installation', lineNumber: 5 },
          { title: 'Prerequisites', lineNumber: 8 },
        ]}
      />
    );
    expect(screen.getByText('Introduction')).toBeInTheDocument();
    expect(screen.getByText('Installation')).toBeInTheDocument();
    expect(screen.getByText('Prerequisites')).toBeInTheDocument();
  });

  it('calls onHeadingBreadcrumbClick when a heading crumb is clicked', async () => {
    const onClick = vi.fn();
    render(
      <Header
        breadcrumbs={[]}
        headingBreadcrumbs={[{ title: 'Setup', lineNumber: 10 }]}
        onHeadingBreadcrumbClick={onClick}
      />
    );
    await userEvent.click(screen.getByText('Setup'));
    expect(onClick).toHaveBeenCalledWith(10);
  });

  it('does not render heading breadcrumb row when headingBreadcrumbs is empty', () => {
    render(<Header breadcrumbs={[]} headingBreadcrumbs={[]} />);
    expect(screen.queryByTestId('heading-breadcrumbs')).not.toBeInTheDocument();
  });

  it('does not render heading breadcrumb row when headingBreadcrumbs is undefined', () => {
    render(<Header breadcrumbs={[]} />);
    expect(screen.queryByTestId('heading-breadcrumbs')).not.toBeInTheDocument();
  });

  it('hides decorative icon glyphs from assistive technology', () => {
    const { container } = render(
      <Header
        breadcrumbs={['AuricIDE', 'README.md']}
        headingBreadcrumbs={[{ title: 'Setup', lineNumber: 1 }]}
        llmConfigured
      />
    );
    const icons = container.querySelectorAll('[data-icon]');
    expect(icons.length).toBeGreaterThan(0);
    icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'));
  });

  it('renders chevron separators between heading crumbs', () => {
    render(
      <Header
        breadcrumbs={[]}
        headingBreadcrumbs={[
          { title: 'A', lineNumber: 1 },
          { title: 'B', lineNumber: 5 },
        ]}
      />
    );
    const headingNav = screen.getByTestId('heading-breadcrumbs');
    const chevrons = headingNav.querySelectorAll('[data-icon]');
    // First icon is the document icon prefix, then one chevron separator between A and B
    expect(chevrons.length).toBeGreaterThanOrEqual(2);
  });
});
