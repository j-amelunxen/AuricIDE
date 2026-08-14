import { describe, expect, it } from 'vitest';
import type { ProviderInfo } from '../tauri/providers';
import fixtures from './providerPolicy.fixtures.json';
import {
  DEFAULT_PROVIDER_POLICY,
  filterProviders,
  isProviderAllowed,
  parseProviderPolicy,
  serializeProviderPolicy,
  type ProviderPolicy,
} from './providerPolicy';

const provider = (id: string): ProviderInfo => ({
  id,
  name: id,
  models: [],
  permissionModes: [],
  defaultModel: '',
  defaultPermissionMode: '',
});

describe('provider policy — shared contract', () => {
  // These two loops are the contract itself. src-tauri/src/provider_policy.rs
  // runs the same cases over the same file; a case that passes here and fails
  // there means the dropdown and the spawn gate disagree about a project.
  describe('parseProviderPolicy', () => {
    for (const testCase of fixtures.parse) {
      it(testCase.name, () => {
        expect(parseProviderPolicy(testCase.raw)).toEqual(testCase.expected);
      });
    }
  });

  describe('isProviderAllowed', () => {
    for (const testCase of fixtures.decide) {
      it(testCase.name, () => {
        expect(isProviderAllowed(testCase.providerId, testCase.policy as ProviderPolicy)).toBe(
          testCase.allowed
        );
      });
    }
  });
});

describe('provider policy — TypeScript surface', () => {
  it('defaults to permitting everything', () => {
    expect(DEFAULT_PROVIDER_POLICY).toEqual({ allow: null, deny: [] });
  });

  it('filters a provider list down to what the project permits', () => {
    const providers = [provider('claude'), provider('opencode'), provider('grok')];
    const policy: ProviderPolicy = { allow: null, deny: ['grok'] };

    expect(filterProviders(providers, policy).map((p) => p.id)).toEqual(['claude', 'opencode']);
  });

  it('keeps the order the registry returned', () => {
    // list_providers sorts the default provider first; re-ordering here would
    // quietly change which provider a dialog preselects.
    const providers = [provider('crush'), provider('claude'), provider('opencode')];
    const policy: ProviderPolicy = { allow: ['opencode', 'crush'], deny: [] };

    expect(filterProviders(providers, policy).map((p) => p.id)).toEqual(['crush', 'opencode']);
  });

  it('can filter everything away', () => {
    // A project may legitimately deny every provider it knows. The callers have
    // to say so rather than render an empty dropdown, so the empty array is a
    // real result and not an error.
    const providers = [provider('claude')];

    expect(filterProviders(providers, { allow: null, deny: ['claude'] })).toEqual([]);
  });

  it('round-trips through storage', () => {
    const policy: ProviderPolicy = { allow: ['claude'], deny: ['grok'] };

    expect(parseProviderPolicy(serializeProviderPolicy(policy))).toEqual(policy);
  });

  it('serializes the open default to a value the parser reads back as open', () => {
    expect(parseProviderPolicy(serializeProviderPolicy(DEFAULT_PROVIDER_POLICY))).toEqual(
      DEFAULT_PROVIDER_POLICY
    );
  });
});
