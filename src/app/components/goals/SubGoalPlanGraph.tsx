'use client';

import { memo, useMemo } from 'react';
import { ReactFlow, Background, Handle, Position, MarkerType, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import type { PmGoal, PmGoalDependency } from '@/lib/tauri/goals';
import {
  buildSubGoalPlanGraph,
  type SubGoalPlanGroup,
  type SubGoalPlanMember,
} from '@/lib/orchestration/subGoalPlanGraph';
import { GOAL_STATUS_STYLES } from './GoalTree';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

interface SubGoalPlanGraphProps {
  goals: PmGoal[];
  dependencies: PmGoalDependency[];
  /** The goal whose direct children are plotted. */
  parentId: string;
  onSelectGoal: (id: string) => void;
}

const NODE_WIDTH = 220;
const MEMBER_LINE_HEIGHT = 18;
// A blocked member wraps onto a second, muted line for its "waits for" note —
// the name gets the full row width instead of sharing it with a truncated pill.
const MEMBER_WAIT_LINE_HEIGHT = 13;
const HEADER_HEIGHT = 20;
const NODE_PADDING = 24;

function memberHeight(member: SubGoalPlanMember): number {
  return MEMBER_LINE_HEIGHT + (member.waitingOnLabel ? MEMBER_WAIT_LINE_HEIGHT : 0);
}

function nodeHeight(group: SubGoalPlanGroup): number {
  return (
    NODE_PADDING +
    (group.bundleLabel ? HEADER_HEIGHT : 0) +
    group.members.reduce((sum, member) => sum + memberHeight(member), 0)
  );
}

interface SubGoalPlanNodeData {
  group: SubGoalPlanGroup;
  onSelectGoal: (id: string) => void;
  [key: string]: unknown;
}

export function SubGoalPlanNode({ data }: NodeProps & { data: SubGoalPlanNodeData }) {
  const { group, onSelectGoal } = data;
  return (
    <div
      data-testid={`subgoal-plan-node-${group.key}`}
      className={`rounded-xl border bg-background-dark/95 px-2.5 py-2 shadow-lg backdrop-blur-sm ${
        group.bundleLabel ? 'border-primary/30' : 'border-white/10'
      }`}
      style={{ width: NODE_WIDTH }}
    >
      <Handle type="target" position={Position.Left} className="!bg-white/30 !border-0 !h-2 !w-2" />
      {group.bundleLabel && (
        <div className="mb-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-primary-light">
          <AuricIcon name="inventory_2" className="text-[11px]" />
          Bundle: {group.bundleLabel}
        </div>
      )}
      <div className="space-y-1">
        {group.members.map((member) => {
          const style = GOAL_STATUS_STYLES[member.status] ?? GOAL_STATUS_STYLES.draft;
          const blocked = member.waitingOnLabel !== null;
          return (
            <button
              key={member.id}
              type="button"
              data-testid={`subgoal-plan-member-${member.id}`}
              onClick={() => onSelectGoal(member.id)}
              title={blocked ? `Waits for ${member.waitingOnLabel}` : member.name}
              className={`flex w-full flex-col rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-white/5 ${
                blocked ? 'opacity-50' : ''
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
                <span className="flex-1 truncate text-[10px] text-foreground/90">
                  {member.name}
                </span>
              </span>
              {blocked && (
                <span
                  data-testid={`subgoal-plan-waiting-${member.id}`}
                  className="truncate pl-3 text-[9px] text-foreground-muted"
                >
                  waits for {member.waitingOnLabel}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-white/30 !border-0 !h-2 !w-2"
      />
    </div>
  );
}

const nodeTypes = { subGoalPlan: memo(SubGoalPlanNode) };

function layoutGroups(
  groups: SubGoalPlanGroup[],
  edges: { id: string; source: string; target: string }[]
): Map<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'LR', nodesep: 16, ranksep: 72 });
  for (const group of groups) {
    graph.setNode(group.key, { width: NODE_WIDTH, height: nodeHeight(group) });
  }
  for (const edge of edges) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);
  return new Map(groups.map((group) => [group.key, graph.node(group.key)]));
}

/**
 * Read-only plan graph for one goal's direct children: parallel sub-goals
 * stack in a column (a wave), serial edges point rightward to what they wait
 * for, and a bundle draws as one framed node. Renders nothing below two
 * children — there is no plan to draw around a single outcome.
 */
export function SubGoalPlanGraph({
  goals,
  dependencies,
  parentId,
  onSelectGoal,
}: SubGoalPlanGraphProps) {
  const { groups, edges } = useMemo(
    () => buildSubGoalPlanGraph(goals, dependencies, parentId),
    [goals, dependencies, parentId]
  );

  const positions = useMemo(() => layoutGroups(groups, edges), [groups, edges]);

  const rfNodes = useMemo(
    () =>
      groups.map((group) => {
        const position = positions.get(group.key) ?? { x: 0, y: 0 };
        return {
          id: group.key,
          type: 'subGoalPlan' as const,
          position: { x: position.x - NODE_WIDTH / 2, y: position.y - nodeHeight(group) / 2 },
          data: { group, onSelectGoal } satisfies SubGoalPlanNodeData,
        };
      }),
    [groups, positions, onSelectGoal]
  );

  const rfEdges = useMemo(
    () =>
      edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(255,255,255,0.35)' },
        style: { stroke: 'rgba(255,255,255,0.25)', strokeDasharray: '4,4' },
      })),
    [edges]
  );

  if (groups.length === 0) return null;

  return (
    <div
      data-testid="subgoal-plan-graph"
      className="h-64 w-full overflow-hidden rounded-xl border border-white/10 bg-black/20"
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        fitView
        minZoom={0.4}
        maxZoom={1.5}
      >
        <Background color="#1e2d3d" gap={20} />
      </ReactFlow>
    </div>
  );
}
