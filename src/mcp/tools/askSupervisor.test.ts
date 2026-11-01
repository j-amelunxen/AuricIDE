import { describe, expect, it, vi } from 'vitest';
import type { FastMCP } from 'fastmcp';
import { buildControlRequest, CONTROL_LIMITS } from '../../lib/agents/agentControl.contract';
import type { ControlCaller } from './agentControl';
import { offersAskSupervisor, registerAskSupervisorTool } from './askSupervisor';

interface Tool {
  name: string;
  execute: (args: unknown) => Promise<string>;
}

function capture(call: ControlCaller): Tool {
  const tools: Tool[] = [];
  registerAskSupervisorTool(
    { addTool: (tool: Tool) => tools.push(tool) } as unknown as FastMCP,
    call
  );
  return tools[0];
}

describe('ask_supervisor', () => {
  it('is offered only to an agent a supervisor started', () => {
    expect(offersAskSupervisor({ AURIC_ASK_SUPERVISOR: '1' })).toBe(true);
    expect(offersAskSupervisor({})).toBe(false);
    expect(offersAskSupervisor({ AURIC_ASK_SUPERVISOR: '0' })).toBe(false);
  });

  it('sends the question and names no agent: the socket finds it by process', async () => {
    const call = vi.fn(async () => ({ agentId: 'agent-5', seq: 1 })) as unknown as ControlCaller;
    const tool = capture(call);
    expect(tool.name).toBe('ask_supervisor');
    const reply = await tool.execute({ question: 'Which branch?', options: ['main', 'next'] });
    expect(call).toHaveBeenCalledWith('raise_question', {
      question: 'Which branch?',
      options: ['main', 'next'],
    });
    expect(JSON.parse(reply)).toEqual({ agentId: 'agent-5', seq: 1 });
  });

  it('validates what it sends before anything reaches the socket', () => {
    const build = (params: unknown) =>
      buildControlRequest(1, 'raise_question', params as { question: string });
    expect(() => build({ question: '   ' })).toThrow();
    expect(() => build({ question: 'x'.repeat(CONTROL_LIMITS.questionMaxBytes + 1) })).toThrow();
    // Counted in bytes, as Rust counts: an umlaut is two.
    expect(() => build({ question: 'ä'.repeat(CONTROL_LIMITS.questionMaxBytes) })).toThrow();
    expect(() => build({ question: 'x', agentId: 'agent-1' })).toThrow();
    expect(() => build({ question: 'x', options: Array(11).fill('o') })).toThrow();
    expect(build({ question: 'x', context: '', options: [] }).params).toEqual({ question: 'x' });
  });
});
