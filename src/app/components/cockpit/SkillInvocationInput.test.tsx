import { render, screen, fireEvent, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SkillInvocationInput } from './SkillInvocationInput';
import type { ProjectSkill } from '@/lib/tauri/projectSkills';

function skill(overrides: Partial<ProjectSkill> & { invocation: string }): ProjectSkill {
  return {
    name: overrides.invocation.replace(/^\//, ''),
    description: null,
    source: 'skill',
    scope: 'project',
    path: `/repo/.claude/skills/${overrides.invocation.replace(/^\//, '')}/SKILL.md`,
    sourceId: 'claude',
    ...overrides,
  };
}

const CATALOGUE: ProjectSkill[] = [
  skill({ invocation: '/changelog', name: 'Changelog', description: 'Summarises recent changes' }),
  skill({ invocation: '/commit', name: 'Commit' }),
  skill({ invocation: '/research', name: 'Research', scope: 'user' }),
];

type Props = React.ComponentProps<typeof SkillInvocationInput>;

/**
 * The field is controlled, so a static `value` would swallow every keystroke
 * and no suggestion would ever appear. The harness owns the text the way a real
 * caller does, and the spy only observes.
 */
function Harness({
  initialValue = '',
  onChange,
  ...props
}: Partial<Props> & { initialValue?: string }) {
  const [value, setValue] = useState(initialValue);
  return (
    <SkillInvocationInput
      discovered={CATALOGUE}
      ariaLabel="Skill 1 prompt"
      placeholder="/changelog"
      onPick={() => {}}
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

function setup(props: Partial<Props> & { initialValue?: string } = {}) {
  const onChange = vi.fn();
  const onPick = vi.fn();
  const view = render(<Harness onChange={onChange} onPick={onPick} {...props} />);
  const input = screen.getByRole('combobox', { name: 'Skill 1 prompt' });
  return { onChange, onPick, input, view };
}

describe('SkillInvocationInput', () => {
  it('stays a plain text field until it is asked for suggestions', () => {
    const { input } = setup();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('reports every keystroke, so free text is never blocked', () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: 'just a prompt' } });
    expect(onChange).toHaveBeenCalledWith('just a prompt');
  });

  it('opens the list as soon as a slash is typed', () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: '/' } });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(3);
  });

  it('narrows the list as more is typed', () => {
    const { input } = setup({ initialValue: '/' });
    fireEvent.change(input, { target: { value: '/commit' } });
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('/commit');
  });

  it('shows each suggestion by name and invocation', () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: '/change' } });
    const option = within(screen.getByRole('listbox')).getByRole('option');
    expect(option).toHaveTextContent('Changelog');
    expect(option).toHaveTextContent('/changelog');
  });

  it('hides the list again when nothing matches, rather than showing an empty box', () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: '/zzzz' } });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('walks the list with the arrow keys and marks the active option', () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: '/' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(within(screen.getByRole('listbox')).getAllByRole('option')[1]).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('wraps around at both ends, so the list has no dead key', () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: '/' } });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(within(screen.getByRole('listbox')).getAllByRole('option')[2]).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('picks the active option on Enter', () => {
    const { input, onPick, onChange } = setup();
    fireEvent.change(input, { target: { value: '/comm' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ invocation: '/commit' }));
    expect(onChange).toHaveBeenLastCalledWith('/commit');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('leaves Enter alone when no option is active, so typed text survives', () => {
    const { input, onPick } = setup();
    fireEvent.change(input, { target: { value: '/' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('picks the option that was clicked', () => {
    const { input, onPick } = setup();
    fireEvent.change(input, { target: { value: '/' } });
    fireEvent.mouseDown(within(screen.getByRole('listbox')).getAllByRole('option')[2]);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ invocation: '/research' }));
  });

  it('closes on Escape without picking anything', () => {
    const { input, onPick } = setup();
    fireEvent.change(input, { target: { value: '/' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('closes when focus leaves the field', () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: '/' } });
    fireEvent.blur(input);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('reopens on focus once something is typed, so a stray Escape is recoverable', () => {
    const { input } = setup({ initialValue: '/comm' });
    fireEvent.focus(input);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('offers nothing at all when no skills were discovered', () => {
    const { input } = setup({ discovered: [] });
    fireEvent.change(input, { target: { value: '/' } });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
