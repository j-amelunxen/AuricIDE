import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Lane } from '@/lib/agents/lanes';
import { FeedComposer } from './FeedComposer';

function makeLane(overrides: Partial<Lane> = {}): Lane {
  return {
    agentId: 'a1',
    agentName: 'Waitlist',
    repoPath: '/repos/acme-app',
    projectLabel: 'acme-app',
    monogram: 'WA',
    color: '#56ccf2',
    state: 'working',
    phaseLabel: 'Running',
    rightNow: 'Editing src/a.ts',
    unread: 0,
    hasQuestion: false,
    muted: false,
    running: true,
    ...overrides,
  };
}

describe('FeedComposer', () => {
  it('sends the trimmed text on Enter and clears the box', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<FeedComposer lane={makeLane()} onSend={onSend} />);

    const box = screen.getByLabelText('Message Waitlist');
    await user.type(box, '  go ahead  ');
    await user.keyboard('{Enter}');

    expect(onSend).toHaveBeenCalledWith('go ahead');
    expect(box).toHaveValue('');
  });

  it('inserts a newline on Shift+Enter instead of sending', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<FeedComposer lane={makeLane()} onSend={onSend} />);

    const box = screen.getByLabelText('Message Waitlist');
    await user.type(box, 'line one');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await user.type(box, 'line two');

    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue('line one\nline two');
  });

  it('does nothing on an empty send', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<FeedComposer lane={makeLane()} onSend={onSend} />);

    const box = screen.getByLabelText('Message Waitlist');
    await user.type(box, '   ');
    await user.keyboard('{Enter}');

    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends via the Send button too', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<FeedComposer lane={makeLane()} onSend={onSend} />);

    await user.type(screen.getByLabelText('Message Waitlist'), 'ping');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSend).toHaveBeenCalledWith('ping');
  });

  it('grows with content, capped at five rows, and resets its height after sending', () => {
    const onSend = vi.fn();
    render(<FeedComposer lane={makeLane()} onSend={onSend} />);
    const box = screen.getByLabelText('Message Waitlist') as HTMLTextAreaElement;

    Object.defineProperty(box, 'scrollHeight', { value: 60, configurable: true });
    fireEvent.change(box, { target: { value: 'line one\nline two' } });
    expect(box.style.height).toBe('60px');

    // Content taller than five rows is capped, not left to grow forever.
    Object.defineProperty(box, 'scrollHeight', { value: 400, configurable: true });
    fireEvent.change(box, {
      target: { value: 'one\ntwo\nthree\nfour\nfive\nsix\nseven' },
    });
    expect(box.style.height).toBe('108px');

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(box.style.height).toBe('');
  });

  it('is disabled with a visible reason when there is no lane', () => {
    render(<FeedComposer lane={null} onSend={vi.fn()} />);

    const box = screen.getByRole('textbox');
    expect(box).toBeDisabled();
    // Visible as the field's own placeholder, not a separate line of text —
    // the composer is one compact row.
    expect(box).toHaveAttribute('placeholder', 'Select a lane to message one agent');
    expect(box).toHaveAccessibleDescription('Select a lane to message one agent');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('is disabled with a visible reason when the agent has stopped', () => {
    render(<FeedComposer lane={makeLane({ running: false })} onSend={vi.fn()} />);

    const box = screen.getByRole('textbox');
    expect(box).toBeDisabled();
    expect(box).toHaveAttribute('placeholder', 'Waitlist has stopped');
    expect(box).toHaveAccessibleDescription('Waitlist has stopped');
  });
});
