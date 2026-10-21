import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../tauri/agents';
import fixtures from './agentControl.fixtures.json';
import { adoptSupervisorChildren } from './supervisorFamily';

const { resumeAdoptsChildren: adoption } = fixtures.supervisors;

const agent = (entry: {
  id: string;
  role: string;
  spawnedByAgentId: string | null;
  repoPath?: string;
}): AgentInfo => ({
  id: entry.id,
  name: entry.id,
  status: 'running',
  model: 'm',
  provider: 'claude',
  startedAt: 0,
  role: entry.role as AgentInfo['role'],
  spawnedByAgentId: entry.spawnedByAgentId,
  repoPath: entry.repoPath,
});

describe('adoptSupervisorChildren', () => {
  it('moves the children Rust names over to the resumed supervisor, as the fixture says', () => {
    // The store holds live and finished agents in one list.
    const agents = [...adoption.live, ...adoption.finished].map(agent);
    const adopted = adoptSupervisorChildren(
      agents,
      adoption.newSupervisorId,
      adoption.expected.adoptedFrom
    );
    const expected = { ...adoption.expected.live, ...adoption.expected.finished };
    for (const entry of adopted) {
      expect(entry.spawnedByAgentId ?? null, entry.id).toBe(
        expected[entry.id as keyof typeof expected]
      );
    }
  });

  it('hands back the same list when nobody was a child of those supervisors', () => {
    const agents = [agent({ id: 'a', role: 'worker', spawnedByAgentId: 'other' })];
    expect(adoptSupervisorChildren(agents, 'new', ['old'])).toBe(agents);
  });
});
