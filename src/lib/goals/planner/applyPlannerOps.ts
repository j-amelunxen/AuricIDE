import type { PlannerGraph, PlannerOp } from './plannerSchema';

/**
 * Applies a refinement batch to the graph, sequentially — each op's indexes
 * refer to the graph as the previous ops left it. An out-of-range index
 * rejects the WHOLE batch: a diff that half-applies is worse than one that
 * fails, because the user can no longer tell which parts of the map to
 * trust. Pure; the input graph is never touched.
 */
export function applyPlannerOps(graph: PlannerGraph, ops: PlannerOp[]): PlannerGraph {
  const stations = graph.stations.map((s) => ({ ...s, predicate: { ...s.predicate } }));

  ops.forEach((op, i) => {
    const inRange = (index: number, max = stations.length - 1): void => {
      if (index < 0 || index > max) {
        throw new Error(
          `ops[${i}] (${op.op}): index ${index} is out of range, graph has ${stations.length} stations`
        );
      }
    };
    switch (op.op) {
      case 'add': {
        const at = op.afterIndex !== undefined ? op.afterIndex + 1 : stations.length;
        if (op.afterIndex !== undefined) inRange(op.afterIndex);
        stations.splice(at, 0, { ...op.station, predicate: { ...op.station.predicate } });
        break;
      }
      case 'remove':
        inRange(op.index);
        stations.splice(op.index, 1);
        break;
      case 'rename':
        inRange(op.index);
        stations[op.index] = { ...stations[op.index], name: op.name };
        break;
      case 'move': {
        inRange(op.index);
        inRange(op.toIndex, stations.length - 1);
        const [moved] = stations.splice(op.index, 1);
        stations.splice(op.toIndex, 0, moved);
        break;
      }
      case 'split': {
        inRange(op.index);
        const base = stations[op.index];
        stations.splice(
          op.index,
          1,
          { ...base, predicate: { ...base.predicate }, name: op.into[0] },
          { ...base, predicate: { ...base.predicate }, name: op.into[1] }
        );
        break;
      }
      case 'set_gate':
        inRange(op.index);
        stations[op.index] = {
          ...stations[op.index],
          kind: op.gate ? 'gate' : 'normal',
        };
        break;
      case 'set_evidence':
        inRange(op.index);
        stations[op.index] = {
          ...stations[op.index],
          evidenceKind: op.evidenceKind,
          predicate: { ...op.predicate },
        };
        break;
    }
  });

  if (stations.length === 0) {
    throw new Error('Refinement would leave the plan empty — batch rejected');
  }
  return { stations };
}
