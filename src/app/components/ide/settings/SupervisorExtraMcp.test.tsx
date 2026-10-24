import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptySupervisorPolicy } from '@/lib/config/supervisorPolicy';
import { setProjectAllowed } from '@/lib/config/supervisorPolicyEdit';
import { SupervisorExtraMcp } from './SupervisorExtraMcp';

const inspect = vi.hoisted(() => vi.fn());
vi.mock('@/lib/tauri/extraMcp', () => ({ extraMcpInspect: inspect }));

const PATH = '/work/project-a';
const base = setProjectAllowed(emptySupervisorPolicy(), PATH, true).projects[PATH];
const ID = `supervisor-extra-mcp-${PATH}`;

describe('SupervisorExtraMcp', () => {
  beforeEach(() => {
    inspect.mockReset();
  });

  it('lists what .mcp.json holds and stores a ticked name', async () => {
    inspect.mockResolvedValue({
      fileFound: true,
      error: null,
      servers: [
        { name: 'motion', transport: 'stdio', problem: null },
        { name: 'broken', transport: 'invalid', problem: 'neither command nor url' },
      ],
    });
    const onChange = vi.fn();
    render(<SupervisorExtraMcp projectPath={PATH} entry={base} onChange={onChange} />);
    const box = await screen.findByTestId(`${ID}-motion`);
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledWith({ ...base, extraMcpServers: ['motion'] });
    expect(screen.getByTestId(`${ID}-broken`)).toBeDisabled();
    expect(screen.getByText(/neither command nor url/)).toBeInTheDocument();
  });

  it('says so when the project has no .mcp.json', async () => {
    inspect.mockResolvedValue({ fileFound: false, error: null, servers: [] });
    render(<SupervisorExtraMcp projectPath={PATH} entry={base} onChange={vi.fn()} />);
    expect(await screen.findByTestId(`${ID}-no-file`)).toBeInTheDocument();
  });

  it('shows a file error and keeps names already chosen as manual entries', async () => {
    inspect.mockResolvedValue({
      fileFound: true,
      error: '.mcp.json is not valid JSON (line 3)',
      servers: [],
    });
    const entry = { ...base, extraMcpServers: ['ghost'] };
    const onChange = vi.fn();
    render(<SupervisorExtraMcp projectPath={PATH} entry={entry} onChange={onChange} />);
    expect(await screen.findByTestId(`${ID}-error`)).toHaveTextContent('not valid JSON');
    expect(screen.getByTestId(`${ID}-manual-ghost`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove ghost' }));
    expect(onChange).toHaveBeenCalledWith({ ...base, extraMcpServers: [] });
  });

  it('adds a typed name only when it is a valid server name', async () => {
    inspect.mockResolvedValue({ fileFound: false, error: null, servers: [] });
    const onChange = vi.fn();
    render(<SupervisorExtraMcp projectPath={PATH} entry={base} onChange={onChange} />);
    const input = await screen.findByTestId(`${ID}-draft`);
    const add = screen.getByTestId(`${ID}-add`);
    await userEvent.type(input, 'bad name!');
    expect(add).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, 'motion');
    await userEvent.click(add);
    expect(onChange).toHaveBeenCalledWith({ ...base, extraMcpServers: ['motion'] });
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('treats an unavailable backend as no file', async () => {
    inspect.mockImplementation(() => Promise.reject(new Error('Tauri IPC is unavailable')));
    render(<SupervisorExtraMcp projectPath={PATH} entry={base} onChange={vi.fn()} />);
    expect(await screen.findByTestId(`${ID}-no-file`)).toBeInTheDocument();
  });
});
