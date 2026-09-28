import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import type { StarredProject } from '@/lib/tauri/starredProjects';
import { ProjectDescriptionDialog } from './ProjectDescriptionDialog';

const setStarredProjectDescription = vi.fn();
const showToast = vi.fn(() => 0);

const project = (extra: Partial<StarredProject> = {}): StarredProject => ({
  path: '/work/portal',
  name: 'portal',
  starredAt: 1,
  ...extra,
});

beforeEach(() => {
  setStarredProjectDescription.mockClear();
  showToast.mockClear();
  useStore.setState({ setStarredProjectDescription, showToast } as Partial<
    ReturnType<typeof useStore.getState>
  >);
});

describe('ProjectDescriptionDialog', () => {
  it('saves the typed description and says so', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ProjectDescriptionDialog project={project()} onClose={onClose} />);

    const field = screen.getByRole('textbox', { name: 'Project description' });
    expect(field).toHaveFocus();
    await user.type(field, '  Customer portal. ');
    expect(screen.getByTestId('project-description-count')).toHaveTextContent('19/300');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(setStarredProjectDescription).toHaveBeenCalledWith('/work/portal', 'Customer portal.');
    expect(showToast).toHaveBeenCalledWith('Description saved for portal', 'success');
    expect(onClose).toHaveBeenCalled();
  });

  it('clears an existing description when saved empty', async () => {
    const user = userEvent.setup();
    render(
      <ProjectDescriptionDialog project={project({ description: 'old' })} onClose={vi.fn()} />
    );

    await user.clear(screen.getByRole('textbox', { name: 'Project description' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(setStarredProjectDescription).toHaveBeenCalledWith('/work/portal', null);
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/cleared.*README/), 'success');
  });

  it('closes on Escape without saving', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ProjectDescriptionDialog project={project()} onClose={onClose} />);

    await user.type(screen.getByRole('textbox', { name: 'Project description' }), 'draft');
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
    expect(setStarredProjectDescription).not.toHaveBeenCalled();
  });

  it('shows a description that arrives after the dialog opened', () => {
    const { rerender } = render(<ProjectDescriptionDialog project={project()} onClose={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'Project description' })).toHaveValue('');

    rerender(
      <ProjectDescriptionDialog
        project={project({ description: 'Loaded late.' })}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole('textbox', { name: 'Project description' })).toHaveValue(
      'Loaded late.'
    );
    expect(screen.getByTestId('project-description-count')).toHaveTextContent('12/300');
  });

  it('is a labelled modal dialog', () => {
    render(<ProjectDescriptionDialog project={project()} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Describe portal' })).toHaveAttribute(
      'aria-modal',
      'true'
    );
  });
});
