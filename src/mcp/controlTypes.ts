import type {
  ControlMethod,
  ControlParamsInput,
  ControlResult,
} from '../lib/agents/agentControl.contract';

export type ControlCaller = <M extends ControlMethod>(
  method: M,
  params: ControlParamsInput<M>
) => Promise<ControlResult<M>>;
