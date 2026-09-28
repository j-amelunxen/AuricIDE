/**
 * Appending to the capped per-agent buffers on the output path.
 *
 * These run for every output batch of every agent, many times a second. The
 * obvious `[...old, ...new].slice(-max)` copies the whole retained buffer
 * twice once it is full; both helpers here build the result with one copy.
 */

/** `[...existing, ...incoming].slice(-max)`, built with a single copy. */
export function appendCapped<T>(existing: readonly T[], incoming: readonly T[], max: number): T[] {
  const drop = Math.max(0, existing.length + incoming.length - max);
  if (drop >= existing.length) return incoming.slice(drop - existing.length);
  const out = existing.slice(drop);
  for (const item of incoming) out.push(item);
  return out;
}

/**
 * Appends output chunks and drops the oldest past either cap — chunk count or
 * total length — always keeping the newest chunk. Returns the new log and its
 * total length.
 */
export function appendCappedLog(
  prev: readonly string[],
  chunks: readonly string[],
  prevBytes: number,
  maxCount: number,
  maxBytes: number
): { logs: string[]; bytes: number } {
  const total = prev.length + chunks.length;
  let bytes = prevBytes;
  for (const chunk of chunks) bytes += chunk.length;
  let drop = 0;
  while (total - drop > 1 && (total - drop > maxCount || bytes > maxBytes)) {
    bytes -= (drop < prev.length ? prev[drop] : chunks[drop - prev.length]).length;
    drop++;
  }
  if (drop >= prev.length) return { logs: chunks.slice(drop - prev.length), bytes };
  const logs = prev.slice(drop);
  for (const chunk of chunks) logs.push(chunk);
  return { logs, bytes };
}
