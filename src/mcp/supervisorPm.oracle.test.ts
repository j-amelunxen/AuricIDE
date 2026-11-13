import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ControlError } from '../lib/agents/agentControl.contract';
import { PmGateway, type PmChild } from './supervisorPm';
import type { ControlCaller } from './controlTypes';

/**
 * The cache half of `verification/lean/AuricIDE/PmScope.lean`: the Lean model's
 * traces against the real gateway, with the model's own answer as the control
 * call and fake children. Rust replays the resolver half
 * (`supervisor/pm_target.rs`). What is left to `supervisorPm.test.ts`: real
 * processes and JSON-RPC.
 */

type Resolution =
  | { kind: 'ok'; path: string }
  | { kind: 'unknown' | 'none_initialized' }
  | { kind: 'not_initialized'; path: string }
  | { kind: 'ambiguous'; candidates: string[] };

type Step =
  | { op: 'set_policy' }
  | {
      op: 'call';
      project: string | null;
      tool: string;
      resolution: Resolution;
      reached: boolean;
      started: boolean;
      closed: string | null;
      cache: string[];
    };

interface Trace {
  name: string;
  steps: Step[];
}

const CORPUS = resolve(__dirname, '../../verification/contracts/pm-scope-v1.jsonl');
const traces: Trace[] = readFileSync(CORPUS, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as Trace);

interface Replay {
  gateway: PmGateway;
  answerWith: (resolution: Resolution) => void;
  started: string[];
  closed: string[];
  reached: string[];
  order: string[];
}

function replayRig(build: (options: ConstructorParameters<typeof PmGateway>[0]) => PmGateway) {
  const rig: Omit<Replay, 'gateway'> = {
    answerWith: () => {},
    started: [],
    closed: [],
    reached: [],
    order: [],
  };
  let current: Resolution = { kind: 'unknown' };
  rig.answerWith = (resolution) => (current = resolution);
  const call = (async () => {
    rig.order.push('policy');
    if (current.kind === 'ok') return { path: current.path, name: 'x' };
    throw new ControlError(
      current.kind === 'unknown' ? 'unknown_project' : 'supervisor_denied',
      current.kind
    );
  }) as unknown as ControlCaller;
  const gateway = build({
    call,
    start: (path) => {
      rig.order.push('child');
      rig.started.push(path);
      const child: PmChild = {
        // Not a tool list, so `pm_tools` never caches one and each `project: null`
        // step really goes to its child, as the model counts it. Once a real
        // list is cached, `pm_tools` touches no child at all, which is less.
        request: async () => {
          rig.reached.push(path);
          return { content: [] };
        },
        close: () => rig.closed.push(path),
      };
      return child;
    },
  });
  return { ...rig, gateway };
}

async function replay(
  trace: Trace,
  build: (o: ConstructorParameters<typeof PmGateway>[0]) => PmGateway
) {
  const rig = replayRig(build);
  for (const step of trace.steps) {
    if (step.op === 'set_policy') continue;
    rig.started.length = rig.closed.length = rig.reached.length = 0;
    rig.answerWith(step.resolution);
    const label = `${trace.name}: ${step.project} -> ${step.resolution.kind}`;
    if (step.project === null) {
      const answer = rig.gateway.describe(undefined, undefined);
      if (step.reached) await answer.catch(() => {});
      else await expect(answer, label).rejects.toThrow();
    } else if (step.reached) {
      await rig.gateway.call(step.project, step.tool, {});
      expect(rig.reached, label).toEqual([(step.resolution as { path: string }).path]);
    } else {
      await expect(rig.gateway.call(step.project, step.tool, {}), label).rejects.toThrow();
      expect(rig.reached, label).toEqual([]);
    }
    expect(rig.started, label).toEqual(
      step.started ? [(step.resolution as { path: string }).path] : []
    );
    expect(rig.closed, label).toEqual(step.closed ? [step.closed] : []);
    expect(rig.gateway.cachedPaths(), label).toEqual(step.cache);
  }
}

describe('the gateway replays the Lean model (pm-scope-v1)', () => {
  it('holds enough of every kind of step to mean something', () => {
    const calls = traces.flatMap((trace) => trace.steps).filter((s) => s.op === 'call');
    const count = (keep: (s: Extract<Step, { op: 'call' }>) => boolean) =>
      calls.filter((s) => s.op === 'call' && keep(s)).length;
    expect(calls.length).toBeGreaterThan(500);
    expect(count((s) => s.started)).toBeGreaterThan(50);
    expect(count((s) => s.reached && !s.started)).toBeGreaterThan(20);
    expect(count((s) => s.resolution.kind === 'ambiguous')).toBeGreaterThan(20);
    expect(count((s) => s.closed !== null)).toBeGreaterThan(2);
  });

  it.each(traces.map((trace) => [trace.name, trace] as const))('%s', async (_name, trace) => {
    await replay(trace, (options) => new PmGateway(options));
  });
});
