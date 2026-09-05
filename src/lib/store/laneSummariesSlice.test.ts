import { describe, expect, it } from 'vitest';
import { create } from 'zustand';
import { createLaneSummariesSlice, type LaneSummariesSlice } from './laneSummariesSlice';

function makeStore() {
  return create<LaneSummariesSlice>()((...a) => createLaneSummariesSlice(...a));
}

describe('laneSummariesSlice', () => {
  it('starts with no summaries', () => {
    expect(makeStore().getState().laneSummaries).toEqual({});
  });

  it('setLaneSummary records a summary for an agent', () => {
    const store = makeStore();
    store
      .getState()
      .setLaneSummary('a1', { kind: 'ask', text: 'Proceed?', at: 1, source: 'extract' });
    expect(store.getState().laneSummaries.a1).toEqual({
      kind: 'ask',
      text: 'Proceed?',
      at: 1,
      source: 'extract',
    });
  });

  it('setting one agent’s summary leaves another agent’s summary untouched', () => {
    const store = makeStore();
    store
      .getState()
      .setLaneSummary('a1', { kind: 'done', text: 'Finished.', at: 1, source: 'extract' });
    store.getState().setLaneSummary('a2', { kind: 'ask', text: 'Proceed?', at: 2, source: 'llm' });

    expect(store.getState().laneSummaries.a1?.text).toBe('Finished.');
    expect(store.getState().laneSummaries.a2?.text).toBe('Proceed?');
  });

  it('a later setLaneSummary for the same agent replaces the earlier one', () => {
    const store = makeStore();
    store
      .getState()
      .setLaneSummary('a1', { kind: 'ask', text: 'Proceed?', at: 1, source: 'extract' });
    store
      .getState()
      .setLaneSummary('a1', { kind: 'ask', text: 'Overwrite the file?', at: 2, source: 'llm' });

    expect(store.getState().laneSummaries.a1).toEqual({
      kind: 'ask',
      text: 'Overwrite the file?',
      at: 2,
      source: 'llm',
    });
  });

  it('clearLaneSummary removes only the named agent’s summary', () => {
    const store = makeStore();
    store
      .getState()
      .setLaneSummary('a1', { kind: 'ask', text: 'Proceed?', at: 1, source: 'extract' });
    store
      .getState()
      .setLaneSummary('a2', { kind: 'done', text: 'Done.', at: 2, source: 'extract' });

    store.getState().clearLaneSummary('a1');

    expect(store.getState().laneSummaries.a1).toBeUndefined();
    expect(store.getState().laneSummaries.a2?.text).toBe('Done.');
  });

  it('clearLaneSummary on an agent with no summary is a no-op', () => {
    const store = makeStore();
    expect(() => store.getState().clearLaneSummary('ghost')).not.toThrow();
    expect(store.getState().laneSummaries).toEqual({});
  });
});
