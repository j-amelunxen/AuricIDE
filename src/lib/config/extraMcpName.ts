/** Twin of `extra_mcp::is_valid_name`; both are checked against `extraMcpName.fixtures.json`. */
export function isValidExtraMcpName(name: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(name);
}
