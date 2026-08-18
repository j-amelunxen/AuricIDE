import { render, screen, fireEvent, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { TicketSkillsField } from './TicketSkillsField';
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
  skill({ invocation: '/tdd', name: 'TDD' }),
  skill({ invocation: '/review', name: 'Review', scope: 'user' }),
];

function Harness({ initial = [] }: { initial?: string[] }) {
  const [skills, setSkills] = useState(initial);
  return <TicketSkillsField skills={skills} discovered={CATALOGUE} onChange={setSkills} />;
}

describe('TicketSkillsField', () => {
  it('adds a picked skill and shows it as a chip', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Add a skill' });
    fireEvent.focus(input);
    fireEvent.mouseDown(within(screen.getByRole('listbox')).getByText('TDD'));

    expect(screen.getByRole('listitem')).toHaveTextContent('/tdd');
    expect(screen.getByRole('listitem')).toHaveTextContent('TDD');
  });

  it('does not offer a skill that is already attached', () => {
    render(<Harness initial={['/tdd']} />);
    fireEvent.focus(screen.getByRole('combobox', { name: 'Add a skill' }));
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('/review');
  });

  it('removes an attached skill', () => {
    render(<Harness initial={['/tdd']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove TDD' }));
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('adds a typed invocation that is not in the catalogue', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Add a skill' });
    fireEvent.change(input, { target: { value: '/custom' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('listitem')).toHaveTextContent('/custom');
  });
});
