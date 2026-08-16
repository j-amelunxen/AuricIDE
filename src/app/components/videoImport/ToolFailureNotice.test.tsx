import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToolFailureNotice } from './ToolFailureNotice';

const TRACEBACK = [
  'Traceback (most recent call last):',
  '  File "/opt/tools/cli.py", line 348, in transcribe',
  "ModuleNotFoundError: No module named 'librosa.filters'",
].join('\n');

describe('ToolFailureNotice', () => {
  it('shows the sentence and keeps the output out of the alert', () => {
    render(
      <ToolFailureNotice
        failure={{
          summary: 'The local transcription runtime is incomplete. Run Setup again.',
          details: TRACEBACK,
          logPath: null,
        }}
      />
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Run Setup again');
    expect(alert.textContent).not.toContain('Traceback');
    expect(alert.textContent).not.toContain('librosa');
  });

  it('offers the output behind a closed fold, not on the page', () => {
    render(
      <ToolFailureNotice failure={{ summary: 'It failed.', details: TRACEBACK, logPath: null }} />
    );
    const fold = screen.getByText('Technical details');
    expect(fold.closest('details')).not.toHaveAttribute('open');
    // Present in the DOM for whoever opens it — just not the headline.
    expect(screen.getByText(/librosa/)).toBeInTheDocument();
  });

  it('omits the fold entirely when there is nothing more to show', () => {
    render(<ToolFailureNotice failure={{ summary: 'It failed.', details: '', logPath: null }} />);
    expect(screen.queryByText('Technical details')).not.toBeInTheDocument();
  });

  it('names the log file when the backend wrote one', () => {
    render(
      <ToolFailureNotice
        failure={{ summary: 'It failed.', details: '', logPath: '/data/runtime/setup.log' }}
      />
    );
    expect(screen.getByText(/setup\.log/)).toBeInTheDocument();
  });

  it('renders nothing at all without a failure', () => {
    const { container } = render(<ToolFailureNotice failure={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
