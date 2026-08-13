import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CommandPalette, CommandPaletteProps } from './CommandPalette';
import { Command } from '@/lib/commands/registry';

function makeCommands(): Command[] {
  return [
    { id: 'file.save', label: 'Save', category: 'file', shortcut: '⌘S', action: vi.fn() },
    { id: 'file.new', label: 'New File', category: 'file', action: vi.fn() },
    { id: 'git.commit', label: 'Commit Changes', category: 'git', action: vi.fn() },
    {
      id: 'view.sidebar',
      label: 'Toggle Sidebar',
      category: 'view',
      shortcut: '⌘B',
      action: vi.fn(),
    },
    { id: 'agent.deploy', label: 'Deploy Agent', category: 'agent', action: vi.fn() },
  ];
}

function renderPalette(overrides: Partial<CommandPaletteProps> = {}) {
  const props: CommandPaletteProps = {
    commands: makeCommands(),
    isOpen: true,
    onClose: vi.fn(),
    onExecute: vi.fn(),
    ...overrides,
  };
  return { ...render(<CommandPalette {...props} />), props };
}

describe('CommandPalette', () => {
  it('renders when isOpen is true', () => {
    renderPalette({ isOpen: true });
    expect(screen.getByTestId('command-palette-overlay')).toBeInTheDocument();
  });

  it('exposes an accessible dialog', () => {
    renderPalette({ isOpen: true });
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    renderPalette({ isOpen: false });
    expect(screen.queryByTestId('command-palette-overlay')).not.toBeInTheDocument();
  });

  it('shows search input focused on open', () => {
    renderPalette();
    const input = screen.getByTestId('command-palette-input');
    expect(input).toHaveFocus();
  });

  it('renders all commands initially', () => {
    renderPalette();
    const items = screen.getAllByTestId('command-palette-item');
    expect(items).toHaveLength(5);
  });

  it('filters commands when typing', async () => {
    const user = userEvent.setup();
    renderPalette();
    const input = screen.getByTestId('command-palette-input');
    await user.type(input, 'save');
    const items = screen.getAllByTestId('command-palette-item');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Save');
  });

  it('shows "No matching commands" when no results', async () => {
    const user = userEvent.setup();
    renderPalette();
    const input = screen.getByTestId('command-palette-input');
    await user.type(input, 'zzzzzzz');
    expect(screen.getByTestId('command-palette-empty')).toHaveTextContent('No matching commands');
    expect(screen.queryAllByTestId('command-palette-item')).toHaveLength(0);
  });

  it('calls onExecute when Enter pressed on selected command', async () => {
    const user = userEvent.setup();
    const { props } = renderPalette();
    await user.keyboard('{Enter}');
    expect(props.onExecute).toHaveBeenCalledWith('file.save');
  });

  it('calls onClose on Escape', async () => {
    const user = userEvent.setup();
    const { props } = renderPalette();
    await user.keyboard('{Escape}');
    expect(props.onClose).toHaveBeenCalled();
  });

  it('arrow keys navigate through results', async () => {
    const user = userEvent.setup();
    renderPalette();
    const items = screen.getAllByTestId('command-palette-item');

    // First item should be selected by default
    expect(items[0]).toHaveAttribute('data-selected', 'true');

    // Arrow down moves to second item
    await user.keyboard('{ArrowDown}');
    const updatedItems = screen.getAllByTestId('command-palette-item');
    expect(updatedItems[0]).toHaveAttribute('data-selected', 'false');
    expect(updatedItems[1]).toHaveAttribute('data-selected', 'true');

    // Arrow up moves back to first item
    await user.keyboard('{ArrowUp}');
    const reUpdatedItems = screen.getAllByTestId('command-palette-item');
    expect(reUpdatedItems[0]).toHaveAttribute('data-selected', 'true');
    expect(reUpdatedItems[1]).toHaveAttribute('data-selected', 'false');
  });

  it('executes the navigated command on Enter', async () => {
    const user = userEvent.setup();
    const { props } = renderPalette();

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(props.onExecute).toHaveBeenCalledWith('file.new');
  });

  it('shows shortcut badge when command has shortcut', () => {
    renderPalette();
    const items = screen.getAllByTestId('command-palette-item');
    const saveItem = items[0];
    expect(within(saveItem).getByTestId('command-shortcut')).toHaveTextContent('⌘S');
  });

  it('does not show shortcut badge when command has no shortcut', () => {
    renderPalette();
    const items = screen.getAllByTestId('command-palette-item');
    // 'New File' (index 1) has no shortcut
    const newFileItem = items[1];
    expect(within(newFileItem).queryByTestId('command-shortcut')).not.toBeInTheDocument();
  });

  it('shows category badge for each command', () => {
    renderPalette();
    const items = screen.getAllByTestId('command-palette-item');
    expect(within(items[0]).getByTestId('command-category')).toHaveTextContent('file');
  });

  it('calls onClose when clicking overlay', async () => {
    const user = userEvent.setup();
    const { props } = renderPalette();
    const overlay = screen.getByTestId('command-palette-overlay');
    await user.click(overlay);
    expect(props.onClose).toHaveBeenCalled();
  });

  it('does not close when clicking inside the modal', async () => {
    const user = userEvent.setup();
    const { props } = renderPalette();
    const modal = screen.getByTestId('command-palette-modal');
    await user.click(modal);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('wraps selection from bottom to top', async () => {
    const user = userEvent.setup();
    renderPalette();

    // Navigate to the last item
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');

    const items = screen.getAllByTestId('command-palette-item');
    expect(items[4]).toHaveAttribute('data-selected', 'true');

    // One more down should wrap to the first
    await user.keyboard('{ArrowDown}');
    const wrapped = screen.getAllByTestId('command-palette-item');
    expect(wrapped[0]).toHaveAttribute('data-selected', 'true');
  });

  it('wraps selection from top to bottom', async () => {
    const user = userEvent.setup();
    renderPalette();

    // Arrow up from first item should wrap to last
    await user.keyboard('{ArrowUp}');
    const items = screen.getAllByTestId('command-palette-item');
    expect(items[4]).toHaveAttribute('data-selected', 'true');
  });

  it('resets selection index when search query changes', async () => {
    const user = userEvent.setup();
    renderPalette();

    // Navigate down
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');

    // Type to filter
    const input = screen.getByTestId('command-palette-input');
    await user.type(input, 'commit');

    const items = screen.getAllByTestId('command-palette-item');
    expect(items[0]).toHaveAttribute('data-selected', 'true');
  });

  it('finds a command by acronym', async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.type(screen.getByTestId('command-palette-input'), 'ts');
    const items = screen.getAllByTestId('command-palette-item');
    expect(items[0]).toHaveTextContent('Toggle Sidebar');
  });

  it('finds a command by scattered characters', async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.type(screen.getByTestId('command-palette-input'), 'cmt');
    const items = screen.getAllByTestId('command-palette-item');
    expect(items[0]).toHaveTextContent('Commit Changes');
  });

  it('highlights the matched characters in the label', async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.type(screen.getByTestId('command-palette-input'), 'cmt');
    const marks = within(screen.getAllByTestId('command-palette-item')[0]).getAllByTestId(
      'command-label-match'
    );
    expect(marks.map((m) => m.textContent).join('')).toBe('Cmt');
  });

  it('lists recently used commands first', () => {
    renderPalette({ recentIds: ['agent.deploy', 'git.commit'] });
    const items = screen.getAllByTestId('command-palette-item');
    expect(items[0]).toHaveTextContent('Deploy Agent');
    expect(items[1]).toHaveTextContent('Commit Changes');
  });

  it('marks recently used commands so they are recognisable', () => {
    renderPalette({ recentIds: ['agent.deploy'] });
    const items = screen.getAllByTestId('command-palette-item');
    expect(within(items[0]).getByTestId('command-recent')).toBeInTheDocument();
    expect(within(items[1]).queryByTestId('command-recent')).not.toBeInTheDocument();
  });

  it('does not mark commands as recent while a query is active', async () => {
    const user = userEvent.setup();
    renderPalette({ recentIds: ['agent.deploy'] });
    await user.type(screen.getByTestId('command-palette-input'), 'deploy');
    const items = screen.getAllByTestId('command-palette-item');
    expect(within(items[0]).queryByTestId('command-recent')).not.toBeInTheDocument();
  });

  it('does not execute anything when Enter is pressed with no results', async () => {
    const user = userEvent.setup();
    const { props } = renderPalette();
    await user.type(screen.getByTestId('command-palette-input'), 'zzzzzzz');
    await user.keyboard('{Enter}');
    expect(props.onExecute).not.toHaveBeenCalled();
  });

  it('keeps arrow navigation stable when there are no results', async () => {
    const user = userEvent.setup();
    const { props } = renderPalette();
    await user.type(screen.getByTestId('command-palette-input'), 'zzzzzzz');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowUp}');
    expect(screen.getByTestId('command-palette-empty')).toBeInTheDocument();
    expect(props.onExecute).not.toHaveBeenCalled();
  });

  it('scrolls the selected command into view', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderPalette();
    await user.keyboard('{ArrowDown}');
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('shows the result count', async () => {
    const user = userEvent.setup();
    renderPalette();
    expect(screen.getByTestId('command-palette-count')).toHaveTextContent('5');
    await user.type(screen.getByTestId('command-palette-input'), 'save');
    expect(screen.getByTestId('command-palette-count')).toHaveTextContent('1');
  });
});

function projectGatedCommands(): Command[] {
  return [
    { id: 'file.save', label: 'Save', category: 'file', action: vi.fn() },
    {
      id: 'file.new',
      label: 'New File',
      category: 'file',
      requiresProject: true,
      action: vi.fn(),
    },
    {
      id: 'git.commit',
      label: 'Commit Changes',
      category: 'git',
      requiresProject: true,
      action: vi.fn(),
    },
  ];
}

describe('CommandPalette project gate', () => {
  it('disables project-required commands when hasProject is false', () => {
    renderPalette({ commands: projectGatedCommands(), hasProject: false });
    const items = screen.getAllByTestId('command-palette-item');
    const save = items.find((el) => el.textContent?.includes('Save'));
    const newFile = items.find((el) => el.textContent?.includes('New File'));
    const commit = items.find((el) => el.textContent?.includes('Commit Changes'));
    expect(save).not.toHaveAttribute('aria-disabled', 'true');
    expect(newFile).toHaveAttribute('aria-disabled', 'true');
    expect(commit).toHaveAttribute('aria-disabled', 'true');
  });

  it('does not execute a project-required command on click when hasProject is false', async () => {
    const user = userEvent.setup();
    const { props } = renderPalette({ commands: projectGatedCommands(), hasProject: false });
    await user.click(screen.getByText('New File'));
    expect(props.onExecute).not.toHaveBeenCalled();
  });

  it('does not execute a project-required command on Enter when hasProject is false', async () => {
    const user = userEvent.setup();
    const { props } = renderPalette({ commands: projectGatedCommands(), hasProject: false });
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(props.onExecute).not.toHaveBeenCalled();
  });

  it('still executes commands that do not require a project when hasProject is false', async () => {
    const user = userEvent.setup();
    const { props } = renderPalette({ commands: projectGatedCommands(), hasProject: false });
    await user.keyboard('{Enter}');
    expect(props.onExecute).toHaveBeenCalledWith('file.save');
  });

  it('executes a project-required command on Enter when hasProject is true', async () => {
    const user = userEvent.setup();
    const { props } = renderPalette({ commands: projectGatedCommands(), hasProject: true });
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(props.onExecute).toHaveBeenCalledWith('file.new');
  });

  it('executes a project-required command on click when hasProject is true', async () => {
    const user = userEvent.setup();
    const { props } = renderPalette({ commands: projectGatedCommands(), hasProject: true });
    await user.click(screen.getByText('New File'));
    expect(props.onExecute).toHaveBeenCalledWith('file.new');
  });

  it('treats a missing hasProject as a project being open', async () => {
    const user = userEvent.setup();
    const { props } = renderPalette({
      commands: [
        {
          id: 'file.new',
          label: 'New File',
          category: 'file',
          requiresProject: true,
          action: vi.fn(),
        },
      ],
    });
    await user.keyboard('{Enter}');
    expect(props.onExecute).toHaveBeenCalledWith('file.new');
  });
});
