import { describe, expect, it } from 'vitest';
import { offersAskSupervisor } from '@/mcp/tools/askSupervisor';
import { controlSocketPath } from '@/mcp/controlClient';
import { AURIC_ENV } from './auricEnv';

// Rust sets these (src-tauri/src/auric_env.rs reads the same fixture); a name
// that drifted would leave the MCP server reading a variable nobody sets.
describe('AURIC_ENV', () => {
  it('names only AURIC_ variables, each once', () => {
    const values = Object.values(AURIC_ENV);
    expect(values.every((name) => name.startsWith('AURIC_'))).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });

  it('is what the MCP server reads', () => {
    expect(offersAskSupervisor({ [AURIC_ENV.askSupervisor]: '1' })).toBe(true);
    expect(controlSocketPath({ [AURIC_ENV.controlSocket]: '/s.sock' })).toBe('/s.sock');
  });
});
