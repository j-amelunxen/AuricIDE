import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const loadAppCredentials = vi.fn();
const loadProjectCredentials = vi.fn();
const dbSet = vi.fn();
const dbDelete = vi.fn();
const showToast = vi.fn();
let rootPath: string | null = '/tmp/project';

vi.mock('@/lib/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ rootPath, showToast }),
}));

vi.mock('@/lib/tauri/appCredentials', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri/appCredentials')>();
  return { ...actual, loadAppCredentials: (...a: unknown[]) => loadAppCredentials(...(a as [])) };
});

vi.mock('@/lib/config/projectConfig', () => ({
  loadProjectCredentials: (...a: unknown[]) => loadProjectCredentials(...(a as [])),
}));

vi.mock('@/lib/tauri/db', () => ({
  dbSet: (...a: unknown[]) => dbSet(...(a as [])),
  dbDelete: (...a: unknown[]) => dbDelete(...(a as [])),
}));

import { CredentialOverride } from './CredentialOverride';

const FIELDS = [
  { key: 'api_key', label: 'API Key', secret: true },
  { key: 'model', label: 'Model' },
];

const renderOverride = () =>
  render(
    <CredentialOverride
      namespace="llm_settings"
      title="LLM"
      icon="psychology"
      blurb="The model behind analysis."
      fields={FIELDS}
    />
  );

beforeEach(() => {
  vi.clearAllMocks();
  rootPath = '/tmp/project';
  loadAppCredentials.mockResolvedValue({});
  loadProjectCredentials.mockResolvedValue({});
});

describe('CredentialOverride', () => {
  it('shows where an inherited value comes from instead of pretending it is local', async () => {
    // An inherited value in a plain field would read as a project setting, and
    // clearing it would look like clearing the key everywhere.
    loadAppCredentials.mockResolvedValue({ model: 'global-model' });

    renderOverride();

    expect(await screen.findByText(/From Application: global-model/)).toBeInTheDocument();
  });

  it('never re-displays an inherited secret in full', async () => {
    // Shaped like a key without looking like one to a secret scanner — the
    // point under test is the masking, not the prefix.
    const stored = 'placeholder-value-1234';
    loadAppCredentials.mockResolvedValue({ api_key: stored });

    renderOverride();

    await waitFor(() => expect(screen.getByText(/••••1234/)).toBeInTheDocument());
    expect(screen.queryByText(stored)).not.toBeInTheDocument();
  });

  it('reports a field that is set nowhere', async () => {
    renderOverride();

    await waitFor(() =>
      expect(screen.getAllByText(/From Application: not set/).length).toBe(FIELDS.length)
    );
  });

  it('writes an override to the project, not to the application store', async () => {
    const user = userEvent.setup();
    loadAppCredentials.mockResolvedValue({ model: 'global-model' });
    renderOverride();

    await user.click(await screen.findByTestId('override-start-llm_settings-model'));
    await user.type(screen.getByTestId('override-llm_settings-model'), 'p');

    await waitFor(() =>
      expect(dbSet).toHaveBeenCalledWith('/tmp/project', 'llm_settings', 'model', 'p')
    );
  });

  it('removes the override rather than storing a blank one', async () => {
    // A parked empty string would have to be read as "deliberately no key
    // here", which is not what clearing a field means.
    const user = userEvent.setup();
    loadProjectCredentials.mockResolvedValue({ model: 'project-model' });
    renderOverride();

    const input = await screen.findByTestId('override-llm_settings-model');
    await user.clear(input);

    await waitFor(() =>
      expect(dbDelete).toHaveBeenCalledWith('/tmp/project', 'llm_settings', 'model')
    );
    expect(dbSet).not.toHaveBeenCalled();
  });

  it('drops back to the application value on request', async () => {
    const user = userEvent.setup();
    loadAppCredentials.mockResolvedValue({ model: 'global-model' });
    loadProjectCredentials.mockResolvedValue({ model: 'project-model' });
    renderOverride();

    await user.click(await screen.findByRole('button', { name: /use the application value/i }));

    expect(dbDelete).toHaveBeenCalledWith('/tmp/project', 'llm_settings', 'model');
    await waitFor(() =>
      expect(screen.getByText(/From Application: global-model/)).toBeInTheDocument()
    );
  });

  it('says which values apply when no project is open', async () => {
    rootPath = null;

    renderOverride();

    expect(
      await screen.findByText(/open a project to give it settings of its own/i)
    ).toBeInTheDocument();
  });

  it('reports a failed save instead of leaving it looking done', async () => {
    const user = userEvent.setup();
    dbSet.mockRejectedValue(new Error('disk full'));
    renderOverride();

    await user.click(await screen.findByTestId('override-start-llm_settings-model'));
    await user.type(screen.getByTestId('override-llm_settings-model'), 'x');

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('Could not save the override'),
        'error'
      )
    );
  });
});

describe('CredentialOverride – the screens built on it', () => {
  it('points the LLM screen at the llm_settings namespace', async () => {
    const { LlmContent } = await import('./LlmContent');
    loadProjectCredentials.mockResolvedValue({});

    render(<LlmContent />);

    await waitFor(() =>
      expect(loadProjectCredentials).toHaveBeenCalledWith('/tmp/project', 'llm_settings')
    );
  });

  it('points the Judge screen at its own namespace, not the LLM one', async () => {
    // Sharing a namespace would make the judge review with the same model it
    // is meant to be independent of.
    const { JudgeLlmContent } = await import('./JudgeLlmContent');

    render(<JudgeLlmContent />);

    await waitFor(() =>
      expect(loadProjectCredentials).toHaveBeenCalledWith('/tmp/project', 'judge_llm_settings')
    );
  });

  it('points the Excalidraw screen at excalidraw_settings', async () => {
    const { ExcalidrawContent } = await import('./ExcalidrawContent');

    render(<ExcalidrawContent />);

    await waitFor(() =>
      expect(loadProjectCredentials).toHaveBeenCalledWith('/tmp/project', 'excalidraw_settings')
    );
  });

  it('renders one field per credential the namespace defines', async () => {
    const { LlmContent } = await import('./LlmContent');

    render(<LlmContent />);

    const section = await screen.findByText(/the model behind analysis/i);
    expect(within(section.parentElement as HTMLElement).getByText('Base URL')).toBeInTheDocument();
  });
});
