import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuickAccessWheelEditor } from './QuickAccessWheelEditor';
import { launchEntries } from '@/lib/quickAccess/launchSkills';
import { WHEEL_SLOT_COUNT } from '@/lib/quickAccess/wheel';
import type { QuickAccessCombo, QuickAccessSkill } from '@/lib/store/starredProjectsSlice';

const changelog: QuickAccessSkill = { id: 's1', label: 'Changelog', prompt: '/changelog' };
const research: QuickAccessSkill = { id: 's2', label: 'Research', prompt: '/research' };
const write: QuickAccessCombo = {
  id: 'combo-1',
  label: 'Write Blog Article',
  steps: [changelog, research],
};

function renderEditor(
  slots: (string | null)[],
  { skills = [changelog, research], combos = [] as QuickAccessCombo[] } = {}
) {
  const onChange = vi.fn();
  render(
    <QuickAccessWheelEditor
      entries={launchEntries(skills, combos)}
      slots={slots}
      onChange={onChange}
      onAnnounce={() => {}}
    />
  );
  return onChange;
}

function emptySlots(): (string | null)[] {
  return Array(WHEEL_SLOT_COUNT).fill(null);
}

describe('QuickAccessWheelEditor', () => {
  it('shows one button per wheel slot', () => {
    renderEditor(emptySlots());
    expect(screen.getAllByTestId(/^wheel-editor-slot-/)).toHaveLength(WHEEL_SLOT_COUNT);
  });

  it('names the entry a filled slot holds, so the arc is readable without hovering', () => {
    renderEditor(['s1', ...emptySlots().slice(1)]);
    expect(screen.getByTestId('wheel-editor-slot-0')).toHaveAccessibleName(/Changelog/);
  });

  it('assigns a skill to the selected slot', () => {
    const onChange = renderEditor(emptySlots());
    fireEvent.click(screen.getByTestId('wheel-editor-slot-2'));
    fireEvent.click(screen.getByTestId('wheel-editor-choice-s2'));
    expect(onChange).toHaveBeenCalledWith([null, null, 's2', null, null, null]);
  });

  it('empties a filled slot', () => {
    const onChange = renderEditor(['s1', ...emptySlots().slice(1)]);
    fireEvent.click(screen.getByTestId('wheel-editor-slot-0'));
    fireEvent.click(screen.getByTestId('wheel-editor-clear'));
    expect(onChange).toHaveBeenCalledWith(emptySlots());
  });

  it('offers no clear on an already empty slot', () => {
    renderEditor(emptySlots());
    fireEvent.click(screen.getByTestId('wheel-editor-slot-1'));
    expect(screen.queryByTestId('wheel-editor-clear')).not.toBeInTheDocument();
  });

  it('swaps when a skill is moved onto an occupied slot', () => {
    const onChange = renderEditor(['s1', 's2', null, null, null, null]);
    fireEvent.click(screen.getByTestId('wheel-editor-slot-0'));
    fireEvent.click(screen.getByTestId('wheel-editor-choice-s2'));
    expect(onChange).toHaveBeenCalledWith(['s2', 's1', null, null, null, null]);
  });

  it('marks a choice that would move rather than fill', () => {
    renderEditor(['s1', null, null, null, null, null]);
    fireEvent.click(screen.getByTestId('wheel-editor-slot-3'));
    expect(screen.getByTestId('wheel-editor-choice-s1')).toHaveAccessibleName(/slot 1/i);
    expect(screen.getByTestId('wheel-editor-choice-s2')).not.toHaveAccessibleName(/slot \d/i);
  });

  it('offers combos alongside single skills', () => {
    renderEditor(emptySlots(), { skills: [changelog], combos: [write] });
    fireEvent.click(screen.getByTestId('wheel-editor-slot-0'));
    expect(screen.getByTestId('wheel-editor-choice-combo:combo-1')).toBeInTheDocument();
  });

  it('drops a slot whose skill is no longer configured', () => {
    renderEditor(['gone', null, null, null, null, null], { skills: [changelog] });
    expect(screen.getByTestId('wheel-editor-slot-0')).toHaveAccessibleName(/empty/i);
  });

  it('says so when there is nothing to put on the wheel yet', () => {
    renderEditor(emptySlots(), { skills: [] });
    fireEvent.click(screen.getByTestId('wheel-editor-slot-0'));
    expect(screen.getByText(/add a skill or a combo/i)).toBeInTheDocument();
  });
});
