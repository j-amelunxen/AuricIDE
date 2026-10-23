import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MANAGER_OKF_FIX, sha256Hex } from '@/lib/agents/supervisorManagers';
import { useStore } from '@/lib/store';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { ManagerMemorySummary, SupervisorManager } from '@/lib/tauri/supervisorManagers';
import type { SupervisorRun } from '@/lib/tauri/supervisorRuns';
import { ManagerInspector } from './ManagerInspector';

const {
  managerInstructions,
  managerMemory,
  managerValidate,
  machineDependencies,
  copyToClipboard,
} = vi.hoisted(() => ({
  managerInstructions: vi.fn(),
  managerMemory: vi.fn(),
  managerValidate: vi.fn(),
  machineDependencies: vi.fn(),
  copyToClipboard: vi.fn(),
}));
vi.mock('@/lib/tauri/supervisorManagers', () => ({
  managerInstructions,
  managerMemory,
  managerValidate,
}));
vi.mock('@/lib/tauri/machine', () => ({ machineDependencies }));
vi.mock('@/lib/tauri/clipboard', () => ({ copyToClipboard }));

const RUN: SupervisorRun = {
  name: '2026-10-21_090000',
  path: '/home/me/.auric/supervisors/2026-10-21_090000',
  modifiedAtMs: 1,
  fileCount: 3,
  truncated: false,
};

const MANAGER: SupervisorManager = {
  key: 'release-desk',
  name: 'Release Desk',
  runDir: RUN.name,
  promotedAt: '2026-10-22T10:15:00Z',
  archivedAt: null,
  lastLaunch: null,
};

const LIVE: AgentInfo = {
  id: 'sup-1',
  name: 'Release Desk',
  model: 'sonnet',
  provider: 'claude',
  status: 'running',
  startedAt: 1,
  role: 'supervisor',
  supervisorKey: 'release-desk',
  repoPath: RUN.path,
};

const memory = (over: Partial<ManagerMemorySummary> = {}): ManagerMemorySummary => ({
  concepts: { Decision: 12, Fact: 20, Lesson: 16 },
  deprecated: 0,
  newestChangeMs: 1,
  findings: [],
  okf: 'ok',
  checkedAt: '2026-10-22T11:00:00Z',
  lastSession: null,
  ...over,
});

const SESSION = {
  title: 'Release 4.2 planning',
  description: 'Agreed the cut-off and parked the migration.',
  atMs: Date.now() - 3 * 3600_000,
  path: 'sessions/release-42.md',
};

function show(props: Partial<React.ComponentProps<typeof ManagerInspector>> = {}) {
  const handlers = {
    onOpen: vi.fn(),
    onAsk: vi.fn(),
    onOpenFile: vi.fn(),
    onEditInstructions: vi.fn(),
    onRestart: vi.fn(),
    onToggleFolder: vi.fn(),
  };
  render(
    <ManagerInspector
      manager={MANAGER}
      run={RUN}
      liveSupervisor={undefined}
      folderOpen={false}
      reloadToken={0}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

describe('ManagerInspector', () => {
  beforeEach(() => {
    managerInstructions
      .mockReset()
      .mockResolvedValue('# Title\n\n- Write every ticket in Spanish.\n');
    managerMemory.mockReset().mockResolvedValue(memory());
    managerValidate.mockReset().mockResolvedValue(memory());
    machineDependencies.mockReset().mockResolvedValue([]);
    copyToClipboard.mockReset().mockResolvedValue(true);
    useStore.setState({ toasts: [] });
  });

  it('shows the address, the folder and a first line of the instructions', async () => {
    show();
    expect(screen.getByText('release-desk')).toBeInTheDocument();
    expect(screen.getByText(RUN.name)).toBeInTheDocument();
    expect(await screen.findByText('Write every ticket in Spanish.')).toBeInTheDocument();
  });

  it('copies the address', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith('release-desk'));
  });

  it('edits the instructions only when there is a file to open', async () => {
    const { onEditInstructions } = show();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit instructions' }));
    expect(onEditInstructions).toHaveBeenCalled();
  });

  it('says so when the instructions file is missing, with nothing to edit', async () => {
    managerInstructions.mockResolvedValue(null);
    show();
    expect(await screen.findByText('No instructions file')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit instructions' })).not.toBeInTheDocument();
  });

  it('reports a file too large for the prompt in the sentence Rust gave', async () => {
    managerInstructions.mockRejectedValue(
      'INSTRUCTIONS.md of Release Desk is 20000 bytes; the limit is 16384.'
    );
    show();
    expect(await screen.findByText(/the limit is 16384/)).toBeInTheDocument();
  });

  it('counts the concepts and lists them by type', async () => {
    show();
    expect(await screen.findByText('48 concepts · checked with okf')).toBeInTheDocument();
    expect(screen.getByText('Decisions 12 · Facts 20 · Lessons 16')).toBeInTheDocument();
  });

  it('says a memory that was never checked has not been checked', async () => {
    managerMemory.mockResolvedValue(memory({ okf: 'never', checkedAt: null }));
    show();
    expect(await screen.findByText('48 concepts · not checked yet')).toBeInTheDocument();
  });

  it('says only the layout was checked when okf was not there', async () => {
    managerMemory.mockResolvedValue(memory({ okf: 'missing' }));
    show();
    expect(await screen.findByText('48 concepts · layout checked')).toBeInTheDocument();
  });

  it('says the number of problems in the memory line when there are findings', async () => {
    managerMemory.mockResolvedValue(
      memory({
        okf: 'findings',
        findings: [{ source: 'okf', code: 'x', path: null, message: 'One.' }],
      })
    );
    show();
    expect(await screen.findByText('48 concepts · 1 problem')).toBeInTheDocument();
  });

  it('keeps amber for real problems and a calm line for information', async () => {
    managerMemory.mockResolvedValue(memory({ okf: 'missing' }));
    const { unmount } = render(
      <ManagerInspector
        manager={MANAGER}
        run={RUN}
        liveSupervisor={undefined}
        folderOpen={false}
        reloadToken={0}
        onOpen={vi.fn()}
        onAsk={vi.fn()}
        onOpenFile={vi.fn()}
        onEditInstructions={vi.fn()}
        onRestart={vi.fn()}
        onToggleFolder={vi.fn()}
      />
    );
    const calm = await screen.findByText('Memory check off: okf is not installed.');
    expect(calm.closest('div')).not.toHaveClass('text-amber-200');
    unmount();

    managerMemory.mockResolvedValue(memory({ okf: 'outdated' }));
    show();
    const problem = await screen.findByText('Memory check off: okf is too old.');
    expect(problem.closest('div')).toHaveClass('text-amber-200');
  });

  it('stays quiet when nothing asks for anything', async () => {
    const text = '# Title\n\n- Write every ticket in Spanish.\n';
    const lastLaunch = { at: '2026-10-22T10:16:02Z', instructionsSha256: await sha256Hex(text) };
    show({ manager: { ...MANAGER, lastLaunch }, liveSupervisor: LIVE });
    await screen.findByText('48 concepts · checked with okf');
    await screen.findByText('Write every ticket in Spanish.');
    expect(screen.queryByRole('button', { name: /Restart/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Memory check/)).not.toBeInTheDocument();
  });

  it('offers a restart when the instructions changed since the running session started', async () => {
    managerInstructions.mockResolvedValue('Be long.');
    const lastLaunch = {
      at: '2026-10-22T10:16:02Z',
      instructionsSha256: await sha256Hex('Be brief.'),
    };
    const { onRestart } = show({ manager: { ...MANAGER, lastLaunch }, liveSupervisor: LIVE });
    expect(
      await screen.findByText('Instructions changed since this session started.')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(onRestart).toHaveBeenCalled();
  });

  it('does not nag about changed instructions when nothing is running', async () => {
    managerInstructions.mockResolvedValue('Be long.');
    const lastLaunch = {
      at: '2026-10-22T10:16:02Z',
      instructionsSha256: await sha256Hex('Be brief.'),
    };
    show({ manager: { ...MANAGER, lastLaunch } });
    await screen.findByText('Be long.');
    expect(screen.queryByText(/Instructions changed/)).not.toBeInTheDocument();
  });

  it('tells a promoted live supervisor it works as a manager from its next start', async () => {
    const { onRestart } = show({ liveSupervisor: LIVE });
    expect(
      await screen.findByText('Works as a Project Manager from its next start.')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restart Now' }));
    expect(onRestart).toHaveBeenCalled();
  });

  it('counts the problems the memory check found and unfolds them on Show', async () => {
    managerMemory.mockResolvedValue(
      memory({
        okf: 'findings',
        findings: [
          { source: 'layout', code: 'missing_type', path: 'facts/a.md', message: 'No type.' },
          { source: 'okf', code: 'orphan', path: null, message: 'An orphan.' },
        ],
      })
    );
    show();
    expect(await screen.findByText('Memory check found 2 problems.')).toBeInTheDocument();
    expect(screen.queryByText('facts/a.md: No type.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByText('facts/a.md: No type.')).toBeInTheDocument();
    expect(screen.getByText('An orphan.')).toBeInTheDocument();
  });

  it('says a single problem in the singular', async () => {
    managerMemory.mockResolvedValue(
      memory({
        okf: 'findings',
        findings: [{ source: 'layout', code: 'x', path: null, message: 'One.' }],
      })
    );
    show();
    expect(await screen.findByText('Memory check found 1 problem.')).toBeInTheDocument();
  });

  describe('when okf is missing', () => {
    beforeEach(() => {
      managerMemory.mockResolvedValue(memory({ okf: 'missing' }));
    });

    it('says the check is off and offers the command to copy', async () => {
      show();
      expect(
        await screen.findByText('Memory check off: okf is not installed.')
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Copy Command' }));
      await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(MANAGER_OKF_FIX));
    });

    it('re-reads the machine, then checks the memory again', async () => {
      managerValidate.mockResolvedValue(memory({ okf: 'ok' }));
      show();
      fireEvent.click(await screen.findByRole('button', { name: 'Check Again' }));
      await waitFor(() => expect(managerValidate).toHaveBeenCalledWith('release-desk'));
      expect(machineDependencies).toHaveBeenCalledWith({ refresh: true });
      await waitFor(() => expect(screen.queryByText(/Memory check off/)).not.toBeInTheDocument());
    });

    it('reports a check that could not run as a toast', async () => {
      managerValidate.mockRejectedValue('boom');
      show();
      fireEvent.click(await screen.findByRole('button', { name: 'Check Again' }));
      await waitFor(() => expect(useStore.getState().toasts).toHaveLength(1));
      expect(useStore.getState().toasts[0]).toMatchObject({ variant: 'error' });
    });
  });

  it('opens the manager and unfolds the folder', async () => {
    const { onOpen, onToggleFolder } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Folder/ }));
    expect(onToggleFolder).toHaveBeenCalled();
    await screen.findByText('48 concepts · checked with okf');
  });

  it('reads the memory again when the rail asks for it', async () => {
    const { rerender } = render(
      <ManagerInspector
        manager={MANAGER}
        run={RUN}
        liveSupervisor={undefined}
        folderOpen={false}
        reloadToken={0}
        onOpen={vi.fn()}
        onAsk={vi.fn()}
        onOpenFile={vi.fn()}
        onEditInstructions={vi.fn()}
        onRestart={vi.fn()}
        onToggleFolder={vi.fn()}
      />
    );
    await screen.findByText('48 concepts · checked with okf');
    managerMemory.mockResolvedValue(memory({ concepts: { Fact: 1 } }));
    rerender(
      <ManagerInspector
        manager={MANAGER}
        run={RUN}
        liveSupervisor={undefined}
        folderOpen={false}
        reloadToken={1}
        onOpen={vi.fn()}
        onAsk={vi.fn()}
        onOpenFile={vi.fn()}
        onEditInstructions={vi.fn()}
        onRestart={vi.fn()}
        onToggleFolder={vi.fn()}
      />
    );
    expect(await screen.findByText('1 concept · checked with okf')).toBeInTheDocument();
  });

  describe('last session', () => {
    it('says there is no session note yet when the manager wrote none', async () => {
      show();
      expect(await screen.findByText('No session note yet')).toBeInTheDocument();
    });

    it("shows the manager's own description and how long ago, with the full text on hover", async () => {
      managerMemory.mockResolvedValue(memory({ lastSession: SESSION }));
      show();
      const description = await screen.findByText(SESSION.description);
      expect(description).toHaveAttribute('title', SESSION.description);
      expect(screen.getByText('3h ago')).toBeInTheDocument();
    });

    it('opens the session note from the memory bundle', async () => {
      managerMemory.mockResolvedValue(memory({ lastSession: SESSION }));
      const { onOpenFile } = show();
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(SESSION.description) }));
      expect(onOpenFile).toHaveBeenCalledWith(`${RUN.path}/knowledge/sessions/release-42.md`);
    });

    it('picks up a session that was written after the inspector was mounted', async () => {
      const handlers = { onOpen: vi.fn(), onAsk: vi.fn(), onOpenFile: vi.fn() };
      const props = {
        manager: MANAGER,
        run: RUN,
        liveSupervisor: undefined,
        folderOpen: false,
        onEditInstructions: vi.fn(),
        onRestart: vi.fn(),
        onToggleFolder: vi.fn(),
        ...handlers,
      };
      const { rerender } = render(<ManagerInspector {...props} reloadToken={0} />);
      await screen.findByText('No session note yet');
      managerMemory.mockResolvedValue(memory({ lastSession: SESSION }));
      rerender(<ManagerInspector {...props} reloadToken={1} />);
      expect(await screen.findByText(SESSION.description)).toBeInTheDocument();
      expect(screen.queryByText('No session note yet')).toBeNull();
    });
  });

  it('opens the memory index from the memory line', async () => {
    const { onOpenFile } = show();
    fireEvent.click(await screen.findByRole('button', { name: /48 concepts/ }));
    expect(onOpenFile).toHaveBeenCalledWith(`${RUN.path}/knowledge/index.md`);
  });

  it('offers Ask next to Open', () => {
    const { onAsk } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Ask Release Desk…' }));
    expect(onAsk).toHaveBeenCalledTimes(1);
  });
});
