import { describe, expect, it } from 'vitest';
import fixtures from './extraMcpName.fixtures.json';
import { isValidExtraMcpName } from './extraMcpName';

// Rust checks the same names (src-tauri/src/extra_mcp.rs); the picker must not
// offer a name the backend then refuses, nor refuse one it would accept.
describe('isValidExtraMcpName', () => {
  it.each(fixtures.valid)('accepts %j', (name) => expect(isValidExtraMcpName(name)).toBe(true));
  it.each(fixtures.invalid)('refuses %j', (name) => expect(isValidExtraMcpName(name)).toBe(false));
});
