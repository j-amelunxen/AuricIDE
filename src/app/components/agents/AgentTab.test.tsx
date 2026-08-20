import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentTab } from './AgentTab';
import type { AgentInfo } from '@/lib/tauri/agents';
import { TAB_PREVIEW_DELAY_MS, TAB_PREVIEW_GRACE_MS } from '@/lib/agents/tabPreview';

const LONG_PROMPT = [
  'testing choochoo image recyling: Kannst du mal bitte zunächst schauen, ob das',
  'Thema Image Recycling nach zwei Fehlversuchen jetzt wirklich sitzt?',
  '',
  'Danach die Fixtures gegen die echte Base gegenprüfen.',
].join('\n');

const agent: AgentInfo = {
  id: 'agent-1',
  name: 'Testing choochoo image recyling',
  model: 'claude-opus-4-6',
  provider: 'claude',
  status: 'running',
  currentTask: LONG_PROMPT,
  startedAt: 1000,
  lastActivityAt: 1000,
};

function renderTab(overrides: Partial<AgentInfo> = {}, props: Record<string, unknown> = {}) {
  return render(
    <AgentTab
      agent={{ ...agent, ...overrides }}
      isActive={false}
      now={1000}
      onSelect={vi.fn()}
      {...props}
    />
  );
}

/** Hover the tab and wait out the dwell delay. */
function dwellOn(agentId = 'agent-1') {
  fireEvent.mouseEnter(screen.getByTestId(`agent-tab-shell-${agentId}`));
  act(() => {
    vi.advanceTimersByTime(TAB_PREVIEW_DELAY_MS);
  });
}

describe('AgentTab – prompt preview on hover', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows nothing while the pointer is only passing over the tab', () => {
    renderTab();
    const shell = screen.getByTestId('agent-tab-shell-agent-1');

    fireEvent.mouseEnter(shell);
    act(() => {
      vi.advanceTimersByTime(TAB_PREVIEW_DELAY_MS - 50);
    });
    expect(screen.queryByTestId('agent-tab-preview-agent-1')).not.toBeInTheDocument();

    fireEvent.mouseLeave(shell);
    act(() => {
      vi.advanceTimersByTime(TAB_PREVIEW_DELAY_MS);
    });
    expect(screen.queryByTestId('agent-tab-preview-agent-1')).not.toBeInTheDocument();
  });

  it('shows the whole original prompt once the pointer rests on the tab', () => {
    renderTab();
    dwellOn();

    const preview = screen.getByTestId('agent-tab-preview-agent-1');
    expect(preview).toHaveTextContent('Kannst du mal bitte zunächst schauen');
    // The tail matters most: the tab and the header line both cut it off.
    expect(preview).toHaveTextContent('Fixtures gegen die echte Base');
  });

  it('keeps the prompt verbatim, line breaks included', () => {
    renderTab();
    dwellOn();
    expect(screen.getByTestId('agent-tab-preview-prompt-agent-1')).toHaveTextContent(LONG_PROMPT, {
      normalizeWhitespace: false,
    });
  });

  it('spells out the full agent name the tab has to truncate', () => {
    renderTab();
    dwellOn();
    expect(screen.getByTestId('agent-tab-preview-agent-1')).toHaveTextContent(
      'Testing choochoo image recyling'
    );
  });

  it('says so when an agent was started without a recorded instruction', () => {
    renderTab({ currentTask: undefined });
    dwellOn();
    expect(screen.getByTestId('agent-tab-preview-agent-1')).toHaveTextContent(/no start prompt/i);
  });

  it('hides the card shortly after the pointer leaves the tab', () => {
    renderTab();
    dwellOn();
    fireEvent.mouseLeave(screen.getByTestId('agent-tab-shell-agent-1'));
    act(() => {
      vi.advanceTimersByTime(TAB_PREVIEW_GRACE_MS);
    });
    expect(screen.queryByTestId('agent-tab-preview-agent-1')).not.toBeInTheDocument();
  });

  it('stays open while the pointer moves into the card to read or copy it', () => {
    renderTab();
    dwellOn();
    fireEvent.mouseLeave(screen.getByTestId('agent-tab-shell-agent-1'));
    fireEvent.mouseEnter(screen.getByTestId('agent-tab-preview-agent-1'));
    act(() => {
      vi.advanceTimersByTime(TAB_PREVIEW_GRACE_MS * 4);
    });
    expect(screen.getByTestId('agent-tab-preview-agent-1')).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByTestId('agent-tab-preview-agent-1'));
    act(() => {
      vi.advanceTimersByTime(TAB_PREVIEW_GRACE_MS);
    });
    expect(screen.queryByTestId('agent-tab-preview-agent-1')).not.toBeInTheDocument();
  });

  it('gets out of the way when the tab is clicked', () => {
    const onSelect = vi.fn();
    renderTab({}, { onSelect });
    dwellOn();
    fireEvent.click(screen.getByTestId('agent-tab-agent-1'));
    expect(onSelect).toHaveBeenCalled();
    expect(screen.queryByTestId('agent-tab-preview-agent-1')).not.toBeInTheDocument();
  });

  it('dismisses on Escape without closing the terminal behind it', () => {
    const onWindowEscape = vi.fn();
    window.addEventListener('keydown', onWindowEscape);
    renderTab();
    dwellOn();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByTestId('agent-tab-preview-agent-1')).not.toBeInTheDocument();
    expect(onWindowEscape).not.toHaveBeenCalled();
    window.removeEventListener('keydown', onWindowEscape);
  });

  it('opens on keyboard focus too, and points assistive tech at the card', () => {
    renderTab();
    const tab = screen.getByTestId('agent-tab-agent-1');
    expect(tab).not.toHaveAttribute('aria-describedby');

    fireEvent.focus(tab);
    act(() => {
      vi.advanceTimersByTime(TAB_PREVIEW_DELAY_MS);
    });
    expect(tab).toHaveAttribute('aria-describedby', 'agent-tab-preview-agent-1');

    fireEvent.blur(tab);
    expect(screen.queryByTestId('agent-tab-preview-agent-1')).not.toBeInTheDocument();
  });

  it('leaves no card behind when the tab unmounts mid-dwell', () => {
    const { unmount } = renderTab();
    fireEvent.mouseEnter(screen.getByTestId('agent-tab-shell-agent-1'));
    unmount();
    act(() => {
      vi.advanceTimersByTime(TAB_PREVIEW_DELAY_MS);
    });
    expect(screen.queryByTestId('agent-tab-preview-agent-1')).not.toBeInTheDocument();
  });
});

describe('AgentTab – the tab itself', () => {
  it('shows the agent name and state', () => {
    renderTab();
    const tab = screen.getByTestId('agent-tab-agent-1');
    expect(tab).toHaveTextContent('Testing choochoo image recyling');
    expect(tab).toHaveAttribute('data-state', 'working');
  });

  it('grows to share leftover strip width, truncating the name instead of capping it', () => {
    renderTab();
    expect(screen.getByTestId('agent-tab-shell-agent-1')).toHaveClass(
      'flex-1',
      'min-w-40',
      'overflow-hidden'
    );
    const name = screen.getByText('Testing choochoo image recyling');
    expect(name).toHaveClass('min-w-0', 'flex-1', 'truncate');
    expect(name).not.toHaveClass('max-w-[140px]');
  });

  it('marks the shown agent as the selected tab', () => {
    renderTab({}, { isActive: true });
    expect(screen.getByTestId('agent-tab-agent-1')).toHaveAttribute('aria-selected', 'true');
  });

  it('offers no end button when ending is not wired up', () => {
    renderTab();
    expect(screen.queryByTestId('agent-tab-close-agent-1')).not.toBeInTheDocument();
  });

  it('ends a running agent from the tab, and says stopping is what that means', () => {
    const onEnd = vi.fn();
    renderTab({}, { onEnd });
    const end = screen.getByTestId('agent-tab-close-agent-1');
    expect(end).toHaveAttribute('aria-label', 'Stop Testing choochoo image recyling');
    fireEvent.click(end);
    expect(onEnd).toHaveBeenCalled();
  });

  it('calls ending a finished agent dismissing', () => {
    renderTab({ status: 'idle' }, { onEnd: vi.fn() });
    expect(screen.getByTestId('agent-tab-close-agent-1')).toHaveAttribute(
      'aria-label',
      'Dismiss Testing choochoo image recyling'
    );
  });

  it('closes the tab on a middle click', () => {
    const onEnd = vi.fn();
    renderTab({}, { onEnd });
    fireEvent(
      screen.getByTestId('agent-tab-agent-1'),
      new MouseEvent('auxclick', { button: 1, bubbles: true })
    );
    expect(onEnd).toHaveBeenCalled();
  });
});
