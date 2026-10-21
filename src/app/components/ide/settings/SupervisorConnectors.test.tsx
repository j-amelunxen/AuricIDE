import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { SupervisorConnectors } from './SupervisorConnectors';
import {
  emptySupervisorPolicy,
  defaultSupervisorProjectPolicy,
  type SupervisorPolicy,
} from '@/lib/config/supervisorPolicy';
import type { ConnectorRegistration } from '@/lib/config/connectorPolicy';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/lib/tauri/invoke', () => ({ invoke }));
const entry: ConnectorRegistration = {
  path: '/fixture/auric-connector.yaml',
  digest: 'a'.repeat(64),
  manifest: {
    schema: 'auric-connector/v0',
    id: 'test-catalog',
    version: '1.0.0',
    transport: 'stdio-mcp',
    auth: 'none',
    launch: { command: './server', args: [], env: {} },
    scopes: ['read', 'write'],
    tools: [
      { name: 'list', scopes: ['read'] },
      { name: 'change', scopes: ['read', 'write'] },
    ],
    briefing: 'Test catalog.',
  },
};
function Editor({ initial }: { initial: SupervisorPolicy }) {
  const [policy, setPolicy] = useState(initial);
  return (
    <>
      <SupervisorConnectors policy={policy} onChange={setPolicy} />
      <output data-testid="policy">{JSON.stringify(policy)}</output>
    </>
  );
}
describe('supervisor connectors settings', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(entry);
  });
  it('previews before approval, derives tools from scopes, and removes grants with the registry entry', async () => {
    const project = { ...defaultSupervisorProjectPolicy(), allowed: true };
    render(<Editor initial={{ ...emptySupervisorPolicy(), projects: { '/a': project } }} />);
    fireEvent.change(screen.getByLabelText('Connector manifest path'), {
      target: { value: entry.path },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review manifest' }));
    await screen.findByRole('button', { name: 'Approve this digest' });
    expect(screen.getByTestId('policy').textContent).not.toContain('test-catalog');
    fireEvent.click(screen.getByRole('button', { name: 'Approve this digest' }));
    fireEvent.click(screen.getByLabelText('Enable test-catalog for this project'));
    expect(screen.getByText('Allowed tools: none (connector will not launch)')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('read'));
    expect(screen.getByText('Allowed tools: list')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('write'));
    expect(screen.getByText('Allowed tools: list, change')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(screen.getByTestId('policy').textContent).not.toContain('test-catalog')
    );
  });
  it('shows digest drift and disables grants when supervisor is not allowed', async () => {
    invoke.mockResolvedValue({ ...entry, digest: 'b'.repeat(64) });
    render(
      <Editor
        initial={{
          ...emptySupervisorPolicy(),
          projects: { '/a': defaultSupervisorProjectPolicy() },
          connectors: { registry: { 'test-catalog': entry }, bindings: {} },
        }}
      />
    );
    expect(screen.getByLabelText('Enable test-catalog for this project')).toBeDisabled();
    expect(
      await screen.findByText('Disabled: manifest changed. Review and re-approve.')
    ).toBeInTheDocument();
  });
  it('shows native manifest errors without approving anything', async () => {
    invoke.mockRejectedValue(new Error('Unsupported auth'));
    render(<Editor initial={emptySupervisorPolicy()} />);
    fireEvent.change(screen.getByLabelText('Connector manifest path'), {
      target: { value: entry.path },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review manifest' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unsupported auth');
    expect(screen.queryByRole('button', { name: 'Approve this digest' })).not.toBeInTheDocument();
  });
});
