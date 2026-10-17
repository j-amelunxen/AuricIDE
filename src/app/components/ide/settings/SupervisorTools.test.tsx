import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolve = vi.fn();
vi.mock('@/lib/tauri/supervisorPolicy', () => ({
  supervisorResolveTool: (name: string) => mockResolve(name),
}));

import { SupervisorTools, invalidToolEntries } from './SupervisorTools';

function type(value: string) {
  fireEvent.change(screen.getByTestId('supervisor-tool-name'), { target: { value } });
}

describe('SupervisorTools', () => {
  beforeEach(() => {
    mockResolve.mockReset().mockResolvedValue(null);
  });

  it('allows a tool by name', () => {
    const onChange = vi.fn();
    render(<SupervisorTools tools={{}} onChange={onChange} />);
    type(' umi ');
    fireEvent.click(screen.getByTestId('supervisor-tool-add'));
    expect(onChange).toHaveBeenCalledWith({ umi: { dirs: [] } });
  });

  it('allows a tool by absolute path, without the trailing slash', () => {
    const onChange = vi.fn();
    render(<SupervisorTools tools={{}} onChange={onChange} />);
    type('/opt/tools/bin/mytool/');
    fireEvent.click(screen.getByTestId('supervisor-tool-add'));
    expect(onChange).toHaveBeenCalledWith({ '/opt/tools/bin/mytool': { dirs: [] } });
  });

  it.each([
    ['', 'Enter a command name or the absolute path of a binary'],
    ['bin/umi', 'A path must be absolute'],
    ['umi; rm -rf ~', 'Use a plain command name'],
    ['/', 'Use a plain command name'],
  ])('refuses %j and says why', (value, reason) => {
    render(<SupervisorTools tools={{}} onChange={vi.fn()} />);
    type(value);
    const add = screen.getByTestId('supervisor-tool-add');
    expect(add).toBeDisabled();
    expect(add.getAttribute('title')).toContain(reason);
  });

  it('refuses a tool that is allowed already', () => {
    render(<SupervisorTools tools={{ umi: { dirs: [] } }} onChange={vi.fn()} />);
    type('umi');
    expect(screen.getByTestId('supervisor-tool-add')).toHaveAttribute(
      'title',
      'This tool is allowed already'
    );
  });

  it('shows where a tool was found, and says so when it was not', async () => {
    mockResolve.mockImplementation(async (name: string) =>
      name === 'umi' ? '/opt/homebrew/bin/umi' : null
    );
    render(
      <SupervisorTools tools={{ umi: { dirs: [] }, ghost: { dirs: [] } }} onChange={vi.fn()} />
    );
    expect(await screen.findByText('found at /opt/homebrew/bin/umi')).toBeInTheDocument();
    expect(await screen.findByText(/not found on PATH/)).toBeInTheDocument();
  });

  it('still lists a tool when the lookup itself fails', async () => {
    mockResolve.mockImplementation(async () => {
      throw new Error('Tauri IPC is unavailable');
    });
    render(<SupervisorTools tools={{ umi: { dirs: [] } }} onChange={vi.fn()} />);
    expect(await screen.findByText('could not check')).toBeInTheDocument();
  });

  it('warns about a tool that runs any code it is given, by name or by path', () => {
    render(
      <SupervisorTools
        tools={{ python3: { dirs: [] }, '/bin/bash': { dirs: [] }, umi: { dirs: [] } }}
        onChange={vi.fn()}
      />
    );
    const warnings = screen.getAllByTestId('supervisor-tool-warning');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toHaveTextContent('runs any code it is given');
  });

  it('keeps the extra folders and removes a tool', async () => {
    const onChange = vi.fn();
    render(<SupervisorTools tools={{ umi: { dirs: ['/abs/data'] } }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Extra folders/), {
      target: { value: '/abs/data\n/abs/more' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ umi: { dirs: ['/abs/data', '/abs/more'] } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove umi' }));
    expect(onChange).toHaveBeenLastCalledWith({});
    await waitFor(() => expect(mockResolve).toHaveBeenCalled());
  });

  it('flags an extra folder Rust would refuse, before it is saved', () => {
    const tools = { umi: { dirs: ['/abs/ok', 'relative'] } };
    render(<SupervisorTools tools={tools} onChange={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('must be an absolute path');
    expect(invalidToolEntries(tools)).toEqual(['relative']);
    expect(invalidToolEntries({ umi: { dirs: ['/abs/ok', ' '] } })).toEqual([]);
  });
});
