import { describe, expect, it } from 'vitest';
import { agentDisplayName } from './displayName';

describe('agentDisplayName', () => {
  it('preserves a meaningful explicit name', () => {
    expect(agentDisplayName('Research assistant', '/goal\n# Goal: Count records')).toBe(
      'Research assistant'
    );
  });

  it('preserves an explicitly renamed slash label', () => {
    expect(agentDisplayName('/API reviewer', 'Review API boundaries')).toBe('/API reviewer');
  });

  it('uses the goal heading for an opaque generated name', () => {
    expect(
      agentDisplayName('/…', '/goal\n# Goal: Count records (goalId: 9d4f-1234)\nInvestigate')
    ).toBe('Count records');
  });

  it('uses the first meaningful task line when there is no goal heading', () => {
    expect(agentDisplayName('...', '/research\n## Context\nSelect audience')).toBe(
      'Select audience'
    );
  });

  it('treats path fragments as generated names', () => {
    expect(agentDisplayName('/root/fix_agent_sidebar_ui', 'Improve the Agents sidebar')).toBe(
      'Improve the Agents sidebar'
    );
  });
});
