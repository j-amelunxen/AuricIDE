import { describe, expect, it } from 'vitest';
import {
  allowedConnectorTools,
  removeConnector,
  type ConnectorRegistration,
} from './connectorPolicy';
import { emptySupervisorPolicy, parseSupervisorPolicy } from './supervisorPolicy';

export const testRegistration: ConnectorRegistration = {
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
    briefing: 'Read the test catalog.',
  },
};
describe('host connector policy', () => {
  it('requires all scopes of a tool, never any single scope', () => {
    expect(allowedConnectorTools(testRegistration, [])).toEqual([]);
    expect(allowedConnectorTools(testRegistration, ['write'])).toEqual([]);
    expect(allowedConnectorTools(testRegistration, ['read'])).toEqual(['list']);
    expect(allowedConnectorTools(testRegistration, ['read', 'write'])).toEqual(['list', 'change']);
  });
  it('preserves registrations and project grants through frontend parsing and edits', () => {
    const policy = {
      ...emptySupervisorPolicy(),
      connectors: {
        registry: { 'test-catalog': testRegistration },
        bindings: { '/a': { 'test-catalog': ['read'] } },
      },
    };
    expect(parseSupervisorPolicy(JSON.stringify(policy)).policy).toEqual(policy);
    expect(
      parseSupervisorPolicy(JSON.stringify({ ...policy, connectors: { registry: [] } })).rejected
    ).toEqual([{ project: null, reason: 'invalid_entry' }]);
    expect(removeConnector(policy.connectors, 'test-catalog')).toEqual({
      registry: {},
      bindings: { '/a': {} },
    });
    expect(policy.connectors.registry['test-catalog']).toBe(testRegistration);
  });
  it('leaves legacy policies with no grants', () => {
    expect(
      parseSupervisorPolicy(JSON.stringify(emptySupervisorPolicy())).policy.connectors
    ).toBeUndefined();
  });
});
