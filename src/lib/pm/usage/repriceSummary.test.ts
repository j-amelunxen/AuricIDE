import { describe, expect, it } from 'vitest';
import type { RepriceReport } from '../../tauri/agentUsage';
import { describeReprice } from './repriceSummary';

function report(overrides: Partial<RepriceReport>): RepriceReport {
  return {
    unpriced: 0,
    repriced: 0,
    stillUnpriced: 0,
    missingEvidence: 0,
    changedEvidence: 0,
    unpricedModels: [],
    ...overrides,
  };
}

describe('describeReprice', () => {
  it('says so when there was nothing to price', () => {
    expect(describeReprice(report({}))).toEqual(['Every run in this project already has a price.']);
  });

  it('reports a clean pass in one sentence', () => {
    expect(describeReprice(report({ unpriced: 15, repriced: 15 }))).toEqual([
      'Priced 15 of 15 runs without a price.',
    ]);
  });

  it('accounts for every run that was not priced, and names the unknown models', () => {
    const lines = describeReprice(
      report({
        unpriced: 6,
        repriced: 1,
        stillUnpriced: 2,
        missingEvidence: 2,
        changedEvidence: 1,
        unpricedModels: ['model-a', 'model-b'],
      })
    );

    expect(lines).toEqual([
      'Priced 1 of 6 runs without a price.',
      '2 runs still have no price: the price list does not know model-a, model-b yet.',
      '2 runs could not be read again: the transcript is gone.',
      '1 run no longer matches its transcript and was left as booked.',
    ]);
  });

  it('uses the singular for one run', () => {
    const lines = describeReprice(
      report({ unpriced: 1, stillUnpriced: 1, unpricedModels: ['model-a'] })
    );

    expect(lines).toEqual([
      'Priced 0 of 1 run without a price.',
      '1 run still has no price: the price list does not know model-a yet.',
    ]);
  });
});
