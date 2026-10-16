import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SupervisorSkills, invalidBashPatterns, skillFolderOf } from './SupervisorSkills';

describe('SupervisorSkills', () => {
  it('approves a folder with its own scripts as the first shell pattern', () => {
    const onChange = vi.fn();
    render(<SupervisorSkills skills={{}} candidates={[]} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('supervisor-skill-folder'), {
      target: { value: '/abs/skills/review/' },
    });
    fireEvent.click(screen.getByTestId('supervisor-skill-add'));
    expect(onChange).toHaveBeenCalledWith({
      '/abs/skills/review': { bash: ['/abs/skills/review/scripts/*'], dirs: [] },
    });
  });

  it('refuses a relative folder and one that is approved already, and says why', () => {
    const { rerender } = render(
      <SupervisorSkills skills={{}} candidates={[]} onChange={vi.fn()} />
    );
    fireEvent.change(screen.getByTestId('supervisor-skill-folder'), {
      target: { value: 'skills/review' },
    });
    expect(screen.getByTestId('supervisor-skill-add')).toBeDisabled();
    rerender(
      <SupervisorSkills
        skills={{ '/abs/skills/review': { bash: [], dirs: [] } }}
        candidates={[]}
        onChange={vi.fn()}
      />
    );
    fireEvent.change(screen.getByTestId('supervisor-skill-folder'), {
      target: { value: '/abs/skills/review' },
    });
    expect(screen.getByTestId('supervisor-skill-add')).toHaveAttribute(
      'title',
      'This skill is approved already'
    );
  });

  it('flags a pattern Rust would refuse, before it is saved', () => {
    const skills = {
      '/abs/skills/review': { bash: ['ok *', 'x) Bash(*'], dirs: ['/abs/ws', 'rel'] },
    };
    render(<SupervisorSkills skills={skills} candidates={[]} onChange={vi.fn()} />);
    const alerts = screen.getAllByRole('alert');
    expect(alerts[0]).toHaveTextContent('may not contain brackets');
    expect(alerts[1]).toHaveTextContent('must be an absolute path');
    expect(invalidBashPatterns(skills)).toEqual(['x) Bash(*', 'rel']);
  });

  it('names a skill by its folder', () => {
    expect(skillFolderOf('/home/u/.claude/skills/notes/SKILL.md')).toBe(
      '/home/u/.claude/skills/notes'
    );
  });
});
