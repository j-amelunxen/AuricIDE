const AGENT_SESSION_PREFIX = 'agent-';

/** The PTY session of an agent: the key Rust registers it under (`agents::pty`). */
export function agentSessionId(agentId: string): string {
  return `${AGENT_SESSION_PREFIX}${agentId}`;
}

/** The agent behind a PTY session id, or null for a shell that is no agent's. */
export function agentIdOfSession(sessionId: string): string | null {
  return sessionId.startsWith(AGENT_SESSION_PREFIX)
    ? sessionId.slice(AGENT_SESSION_PREFIX.length)
    : null;
}
