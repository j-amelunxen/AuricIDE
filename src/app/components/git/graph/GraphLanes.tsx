import { graphColorHex } from '@/lib/git/graphColors';
import type { GraphRow } from '@/lib/git/graphLayout';
import { DOT_RADIUS, LINE_WIDTH, ROW_HEIGHT, edgePath, laneX } from './graphGeometry';

const HEAD_RING_RADIUS = DOT_RADIUS + 3;

interface GraphLanesProps {
  row: GraphRow;
  width: number;
  isHead: boolean;
}

/**
 * The lines and the dot of one row. Merge dots are hollow: the hole takes the
 * row's own background through `--graph-hole`, so a selected row stays clean.
 */
export function GraphLanes({ row, width, isHead }: GraphLanesProps) {
  const color = graphColorHex(row.color);
  const cx = laneX(row.lane);
  const cy = ROW_HEIGHT / 2;
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={ROW_HEIGHT}
      viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
      className="shrink-0"
    >
      {row.edges.map((edge, i) => (
        <path
          key={i}
          d={edgePath(edge)}
          stroke={graphColorHex(edge.color)}
          strokeWidth={LINE_WIDTH}
          strokeLinecap="round"
          fill="none"
        />
      ))}
      {isHead && (
        <circle
          cx={cx}
          cy={cy}
          r={HEAD_RING_RADIUS}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={1.5}
        />
      )}
      {row.isMerge ? (
        <circle
          cx={cx}
          cy={cy}
          r={DOT_RADIUS - LINE_WIDTH / 2}
          fill="var(--graph-hole)"
          stroke={color}
          strokeWidth={LINE_WIDTH}
        />
      ) : (
        <circle cx={cx} cy={cy} r={DOT_RADIUS} fill={color} />
      )}
    </svg>
  );
}
