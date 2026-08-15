import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadAuricSkills, saveAuricSkills } from '@/lib/settings/auricSkills';
import { AuricSkillsContent } from './AuricSkillsContent';

describe('AuricSkillsContent', () => {
  beforeEach(() => saveAuricSkills([]));

  it('creates and saves one application-wide prompt skill', () => {
    render(<AuricSkillsContent />);

    fireEvent.click(screen.getByTestId('auric-skill-add'));
    fireEvent.change(screen.getByLabelText('Auric skill 1 name'), {
      target: { value: 'Code Review' },
    });
    fireEvent.change(screen.getByLabelText('Auric skill 1 description'), {
      target: { value: 'Checks a change before handoff.' },
    });
    fireEvent.change(screen.getByLabelText('Auric skill 1 prompt'), {
      target: { value: 'Inspect the current change and report concrete findings.' },
    });
    fireEvent.click(screen.getByTestId('auric-skills-save'));

    expect(loadAuricSkills()).toEqual([
      expect.objectContaining({
        name: 'Code Review',
        description: 'Checks a change before handoff.',
        prompt: 'Inspect the current change and report concrete findings.',
      }),
    ]);
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('does not save an incomplete definition', () => {
    render(<AuricSkillsContent />);
    fireEvent.click(screen.getByTestId('auric-skill-add'));
    expect(screen.getByTestId('auric-skills-save')).toBeDisabled();
    expect(screen.getByText(/name and prompt are required/i)).toBeInTheDocument();
  });

  it('deletes a saved definition from the shared library', () => {
    saveAuricSkills([{ id: 'review', name: 'Code Review', prompt: 'Review it.' }]);
    render(<AuricSkillsContent />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Code Review' }));
    fireEvent.click(screen.getByTestId('auric-skills-save'));
    expect(loadAuricSkills()).toEqual([]);
  });
});
