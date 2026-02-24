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

  it('shows connected status by default', () => {
    render(<Header breadcrumbs={[]} isConnected connectionLabel="Claude 3.5 Connected" />);
    expect(screen.getByTestId('connection-badge')).toHaveTextContent('Claude 3.5 Connected');
  });

  it('shows disconnected status', () => {
    render(<Header breadcrumbs={[]} isConnected={false} />);
    expect(screen.getByTestId('connection-badge')).toHaveTextContent('Disconnected');
  });

  it('renders command palette trigger', () => {
    render(<Header breadcrumbs={[]} />);
    expect(screen.getByTestId('command-palette-trigger')).toBeInTheDocument();
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
    const chevrons = headingNav.querySelectorAll('.material-symbols-outlined');
    // First icon is the document icon prefix, then one chevron separator between A and B
    expect(chevrons.length).toBeGreaterThanOrEqual(2);
  });
});
