import { z } from 'zod';

const names = z.array(z.string());
const manifestSchema = z.strictObject({
  schema: z.literal('auric-connector/v0'),
  id: z.string().regex(/^[a-z0-9-]+$/),
  version: z.string(),
  transport: z.literal('stdio-mcp'),
  launch: z.strictObject({
    command: z.string(),
    args: names,
    env: z.record(z.string(), z.string()),
  }),
  scopes: names,
  tools: z.array(z.strictObject({ name: z.string(), scopes: names })),
  briefing: z.string(),
  auth: z.literal('none'),
});
const registrationSchema = z.strictObject({
  path: z.string().startsWith('/'),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  manifest: manifestSchema,
});
export const connectorPolicySchema = z
  .strictObject({
    registry: z.record(z.string(), registrationSchema).default({}),
    bindings: z.record(z.string(), z.record(z.string(), names)).default({}),
  })
  .superRefine((policy, context) => {
    const invalid = (message: string) => context.addIssue({ code: 'custom', message });
    const unique = (values: string[]) => new Set(values).size === values.length;
    for (const [id, entry] of Object.entries(policy.registry)) {
      const manifest = entry.manifest;
      if (
        id !== manifest.id ||
        !unique(manifest.scopes) ||
        !unique(manifest.tools.map((tool) => tool.name))
      )
        invalid('Invalid connector identity or duplicate inventory');
      for (const tool of manifest.tools) {
        if (!unique(tool.scopes) || tool.scopes.some((scope) => !manifest.scopes.includes(scope)))
          invalid('Unknown or duplicate tool scope');
      }
    }
    for (const [root, grants] of Object.entries(policy.bindings)) {
      if (!root.startsWith('/')) invalid('Project root must be absolute');
      for (const [id, scopes] of Object.entries(grants)) {
        const entry = policy.registry[id];
        if (
          !entry ||
          !unique(scopes) ||
          scopes.some((scope) => !entry.manifest.scopes.includes(scope))
        )
          invalid('Unknown connector or scope');
      }
    }
  });
export type ConnectorRegistration = z.infer<typeof registrationSchema>;
export type ConnectorPolicy = z.infer<typeof connectorPolicySchema>;

export function allowedConnectorTools(entry: ConnectorRegistration, scopes: string[]): string[] {
  return entry.manifest.tools
    .filter((tool) => tool.scopes.every((scope) => scopes.includes(scope)))
    .map((tool) => tool.name);
}

/** Removing an imported definition also removes all grants; reimport starts unbound. */
export function removeConnector(policy: ConnectorPolicy, id: string): ConnectorPolicy {
  const registry = { ...policy.registry };
  delete registry[id];
  const bindings = Object.fromEntries(
    Object.entries(policy.bindings).map(([root, grants]) => {
      const next = { ...grants };
      delete next[id];
      return [root, next];
    })
  );
  return { registry, bindings };
}
