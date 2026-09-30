import type { RepriceReport } from '../../tauri/agentUsage';

function runs(count: number): string {
  return count === 1 ? '1 run' : `${count} runs`;
}

/**
 * The sentences a "Recalculate pricing" pass ends with. Every run that was
 * looked at is accounted for, so a partial result never reads as a full one.
 */
export function describeReprice(report: RepriceReport): string[] {
  if (report.unpriced === 0) return ['Every run in this project already has a price.'];

  const lines = [`Priced ${report.repriced} of ${runs(report.unpriced)} without a price.`];
  if (report.stillUnpriced > 0) {
    const models = report.unpricedModels.join(', ') || 'their model';
    lines.push(
      report.stillUnpriced === 1
        ? `1 run still has no price: the price list does not know ${models} yet.`
        : `${report.stillUnpriced} runs still have no price: the price list does not know ${models} yet.`
    );
  }
  if (report.missingEvidence > 0) {
    lines.push(`${runs(report.missingEvidence)} could not be read again: the transcript is gone.`);
  }
  if (report.changedEvidence > 0) {
    lines.push(
      report.changedEvidence === 1
        ? '1 run no longer matches its transcript and was left as booked.'
        : `${report.changedEvidence} runs no longer match their transcripts and were left as booked.`
    );
  }
  return lines;
}
