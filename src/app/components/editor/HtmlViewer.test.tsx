import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HtmlViewer } from './HtmlViewer';

const SAMPLE = '<h1>Drilldown</h1><p>Root cause analysis</p>';

describe('HtmlViewer', () => {
  it('shows the file name', () => {
    render(<HtmlViewer content={SAMPLE} fileName="report.html" />);
    expect(screen.getByText('report.html')).toBeInTheDocument();
  });

  it('renders a sandboxed preview iframe with the html as srcDoc by default', () => {
    const { container } = render(<HtmlViewer content={SAMPLE} fileName="report.html" />);
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe).toHaveAttribute('sandbox');
    expect(iframe!.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(iframe!.getAttribute('srcdoc')).toContain('Root cause analysis');
  });

  it('marks Preview as the active tab by default', () => {
    render(<HtmlViewer content={SAMPLE} fileName="report.html" />);
    expect(screen.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Source' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches to the raw source and back', async () => {
    const user = userEvent.setup();
    const { container } = render(<HtmlViewer content={SAMPLE} fileName="report.html" />);

    await user.click(screen.getByRole('button', { name: 'Source' }));
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByText(/Root cause analysis/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Source' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(container.querySelector('iframe')).not.toBeNull();
  });
});
