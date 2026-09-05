'use client';

import type { EpicProjection, ProjectProjection } from '@/lib/pm/metrics';
import { MetricPanel, ProgressCell, DASH } from './metricsUi';

export interface EpicProjectionsTableProps {
  projections: EpicProjection[];
  project: ProjectProjection;
}

export function EpicProjectionsTable({ projections, project }: EpicProjectionsTableProps) {
  if (projections.length === 0) return null;

  return (
    <MetricPanel title="Epic Projections">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-foreground-muted text-left border-b border-white/[0.08]">
            <th className="pb-2 font-medium">Epic</th>
            <th className="pb-2 font-medium text-center">Total</th>
            <th className="pb-2 font-medium text-center">Done</th>
            <th className="pb-2 font-medium text-center">Progress</th>
            <th className="pb-2 font-medium text-center">Left</th>
            <th className="pb-2 font-medium text-right">Est. Days</th>
            <th className="pb-2 font-medium text-right">Est. Date</th>
          </tr>
        </thead>
        <tbody>
          {projections.map((p) => (
            <tr key={p.epicId} className="border-b border-white/[0.04]">
              <td className="py-2 text-foreground">{p.epicName}</td>
              <td className="py-2 text-center text-foreground-muted">{p.totalTickets}</td>
              <td className="py-2 text-center text-foreground-muted">{p.completedTickets}</td>
              <td className="py-2 text-center">
                <ProgressCell done={p.completedTickets} total={p.totalTickets} />
              </td>
              <td className="py-2 text-center text-foreground-muted">{p.remainingTickets}</td>
              <td className="py-2 text-right text-foreground-muted">
                {p.estimatedDaysRemaining !== null ? `${p.estimatedDaysRemaining}d` : DASH}
              </td>
              <td className="py-2 text-right text-foreground-muted">
                {p.estimatedCompletionDate ?? DASH}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="text-foreground font-semibold border-t border-white/[0.08]">
            <td className="py-3">Project</td>
            <td className="py-3 text-center">{project.totalTickets}</td>
            <td className="py-3 text-center">{project.completedTickets}</td>
            <td className="py-3 text-center">
              <ProgressCell done={project.completedTickets} total={project.totalTickets} />
            </td>
            <td className="py-3 text-center">{project.remainingTickets}</td>
            <td className="py-3 text-right">
              {project.estimatedDaysRemaining !== null
                ? `${project.estimatedDaysRemaining}d`
                : DASH}
            </td>
            <td className="py-3 text-right">{project.estimatedCompletionDate ?? DASH}</td>
          </tr>
        </tfoot>
      </table>
      <p className="text-[10px] text-foreground-muted mt-3">
        Each epic&apos;s estimate assumes the whole throughput is aimed at it, so the project row is
        the shared estimate rather than the sum of the rows above.
      </p>
    </MetricPanel>
  );
}
