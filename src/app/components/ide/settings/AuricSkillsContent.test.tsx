import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AURIC_SKILLS_KIND,
  AURIC_SKILLS_SCHEMA_VERSION,
  loadAuricSkills,
  saveAuricSkills,
  serializeAuricSkills,
} from '@/lib/settings/auricSkills';
import { useStore } from '@/lib/store';
import { AuricSkillsContent } from './AuricSkillsContent';

const mockSaveDialog = vi.fn();
const mockOpenDialog = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: (...args: unknown[]) => mockSaveDialog(...args),
  open: (...args: unknown[]) => mockOpenDialog(...args),
}));

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
vi.mock('@/lib/tauri/fs', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

const review = {
  id: 'review',
  name: 'Code Review',
  prompt: 'Inspect the current change and report concrete findings.',
};

describe('AuricSkillsContent', () => {
  beforeEach(() => {
    saveAuricSkills([]);
    mockSaveDialog.mockReset();
    mockOpenDialog.mockReset();
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockWriteFile.mockResolvedValue(undefined);
    useStore.setState({ toasts: [] });
  });

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

  it('offers export and import even when the library is empty', () => {
    render(<AuricSkillsContent />);
    expect(screen.getByRole('button', { name: 'Import…' })).toBeEnabled();
    const exportButton = screen.getByRole('button', { name: 'Export, nothing complete to export' });
    expect(exportButton).toBeDisabled();
    expect(exportButton).toHaveAttribute('title', 'Nothing complete to export');
  });

  it('writes the current library as JSON when export is confirmed', async () => {
    const user = userEvent.setup();
    saveAuricSkills([review]);
    mockSaveDialog.mockResolvedValueOnce('/tmp/auric-skills.json');

    render(<AuricSkillsContent />);
    await user.click(screen.getByTestId('auric-skills-export'));

    await waitFor(() => {
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/tmp/auric-skills.json',
        serializeAuricSkills([review])
      );
    });
    expect(mockSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: 'auric-skills.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
    );
    expect(useStore.getState().toasts.some((t) => /exported 1 auric skill/i.test(t.message))).toBe(
      true
    );
  });

  it('does not write a file when the export picker is cancelled', async () => {
    const user = userEvent.setup();
    saveAuricSkills([review]);
    mockSaveDialog.mockResolvedValueOnce(null);

    render(<AuricSkillsContent />);
    await user.click(screen.getByTestId('auric-skills-export'));

    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('imports a JSON file into the library and keeps matching ids in place', async () => {
    const user = userEvent.setup();
    saveAuricSkills([review]);
    const incoming = [
      { ...review, prompt: 'Be stricter.' },
      { id: 'ship', name: 'Ship it', prompt: 'Prepare the change for merge.' },
    ];
    mockOpenDialog.mockResolvedValueOnce('/tmp/skills.json');
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        kind: AURIC_SKILLS_KIND,
        schemaVersion: AURIC_SKILLS_SCHEMA_VERSION,
        skills: incoming,
      })
    );

    render(<AuricSkillsContent />);
    await user.click(screen.getByTestId('auric-skills-import'));

    await waitFor(() => {
      expect(screen.getByLabelText('Auric skill 1 prompt')).toHaveValue('Be stricter.');
    });
    expect(screen.getByLabelText('Auric skill 2 name')).toHaveValue('Ship it');
    expect(loadAuricSkills()).toEqual(incoming);
    expect(useStore.getState().toasts.some((t) => /added 1, updated 1/i.test(t.message))).toBe(
      true
    );
  });

  it('does nothing when the import picker is cancelled', async () => {
    const user = userEvent.setup();
    mockOpenDialog.mockResolvedValueOnce(null);

    render(<AuricSkillsContent />);
    await user.click(screen.getByTestId('auric-skills-import'));

    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('does not persist an import over an incomplete draft, and says so', async () => {
    const user = userEvent.setup();
    render(<AuricSkillsContent />);
    fireEvent.click(screen.getByTestId('auric-skill-add'));
    mockOpenDialog.mockResolvedValueOnce('/tmp/skills.json');
    mockReadFile.mockResolvedValueOnce(serializeAuricSkills([review]));

    await user.click(screen.getByTestId('auric-skills-import'));

    await waitFor(() => {
      expect(screen.getByLabelText('Auric skill 2 name')).toHaveValue('Code Review');
    });
    expect(loadAuricSkills()).toEqual([]);
    expect(
      useStore
        .getState()
        .toasts.some((t) =>
          /imported 1 auric skill\. save the library to keep it\./i.test(t.message)
        )
    ).toBe(true);
  });

  it('toasts when the picked file is not an Auric skills export', async () => {
    const user = userEvent.setup();
    mockOpenDialog.mockResolvedValueOnce('/tmp/bad.json');
    mockReadFile.mockResolvedValueOnce('{ not json');

    render(<AuricSkillsContent />);
    await user.click(screen.getByTestId('auric-skills-import'));

    await waitFor(() => {
      expect(useStore.getState().toasts.some((t) => t.variant === 'error')).toBe(true);
    });
    expect(loadAuricSkills()).toEqual([]);
  });
});
