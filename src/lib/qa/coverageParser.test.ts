import { describe, it, expect } from 'vitest';
import {
  parseCoverageSummary,
  parseCoverageFinal,
  parseLcov,
  parseByFormat,
} from './coverageParser';

// ---------------------------------------------------------------------------
// coverage-summary (Vitest/Jest/nyc)
// ---------------------------------------------------------------------------

describe('parseCoverageSummary', () => {
  const sampleData = {
    total: {
      lines: { pct: 80 },
      statements: { pct: 75 },
      functions: { pct: 70 },
      branches: { pct: 65 },
    },
    'src/file.ts': {
      lines: { pct: 90 },
      statements: { pct: 85 },
      functions: { pct: 80 },
      branches: { pct: 75 },
    },
  };

  it('parses total summary', () => {
    const result = parseCoverageSummary(JSON.stringify(sampleData));
    expect(result.summary).toEqual({ lines: 80, statements: 75, functions: 70, branches: 65 });
  });

  it('parses file coverage', () => {
    const result = parseCoverageSummary(JSON.stringify(sampleData));
    expect(result.files).toEqual([
      { path: 'src/file.ts', size: 0, lines: 90, statements: 85, functions: 80, branches: 75 },
    ]);
  });

  it('excludes the total key from files', () => {
    const result = parseCoverageSummary(JSON.stringify(sampleData));
    expect(result.files.find((f) => f.path === 'total')).toBeUndefined();
  });

  it('handles multiple files', () => {
    const multiFile = {
      total: {
        lines: { pct: 70 },
        statements: { pct: 70 },
        functions: { pct: 70 },
        branches: { pct: 70 },
      },
      'src/a.ts': {
        lines: { pct: 60 },
        statements: { pct: 60 },
        functions: { pct: 60 },
        branches: { pct: 60 },
      },
      'src/b.ts': {
        lines: { pct: 80 },
        statements: { pct: 80 },
        functions: { pct: 80 },
        branches: { pct: 80 },
      },
    };
    const result = parseCoverageSummary(JSON.stringify(multiFile));
    expect(result.files).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// coverage-final (Istanbul/nyc raw output)
// ---------------------------------------------------------------------------

describe('parseCoverageFinal', () => {
  const sampleData = {
    'src/a.ts': {
      path: 'src/a.ts',
      s: { '0': 1, '1': 0, '2': 1 }, // 2/3 covered → 66.67%
      b: { '0': [1, 0], '1': [1, 1] }, // 3/4 branches covered → 75%
      f: { '0': 1, '1': 0 }, // 1/2 functions covered → 50%
    },
  };

  it('calculates statement coverage from s map', () => {
    const result = parseCoverageFinal(JSON.stringify(sampleData));
    expect(result.files[0].statements).toBeCloseTo(66.67, 1);
  });

  it('calculates function coverage from f map', () => {
    const result = parseCoverageFinal(JSON.stringify(sampleData));
    expect(result.files[0].functions).toBe(50);
  });

  it('calculates branch coverage from b map', () => {
    const result = parseCoverageFinal(JSON.stringify(sampleData));
    expect(result.files[0].branches).toBe(75);
  });

  it('uses statements as proxy for lines', () => {
    const result = parseCoverageFinal(JSON.stringify(sampleData));
    expect(result.files[0].lines).toBeCloseTo(result.files[0].statements, 5);
  });

  it('uses key as file path', () => {
    const result = parseCoverageFinal(JSON.stringify(sampleData));
    expect(result.files[0].path).toBe('src/a.ts');
  });

  it('aggregates summary as weighted total over files (single file)', () => {
    const result = parseCoverageFinal(JSON.stringify(sampleData));
    expect(result.summary.statements).toBeCloseTo(66.67, 1);
    expect(result.summary.functions).toBe(50);
    expect(result.summary.branches).toBe(75);
  });

  it('uses weighted totals not per-file average for multi-file summary', () => {
    // File A: 1/2 stmts = 50%
    // File B: 8/8 stmts = 100%
    // average: (50+100)/2 = 75%, weighted: 9/10 = 90%
    const multiFile = {
      'src/a.ts': { s: { '0': 1, '1': 0 }, f: {}, b: {} },
      'src/b.ts': {
        s: { '0': 1, '1': 1, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 1 },
        f: {},
        b: {},
      },
    };
    const result = parseCoverageFinal(JSON.stringify(multiFile));
    expect(result.summary.statements).toBe(90); // 9/10 weighted
  });

  it('returns zero summary for empty input', () => {
    const result = parseCoverageFinal(JSON.stringify({}));
    expect(result.summary).toEqual({ lines: 0, statements: 0, functions: 0, branches: 0 });
    expect(result.files).toHaveLength(0);
  });

  it('handles missing s/b/f maps', () => {
    const data = { 'src/empty.ts': { path: 'src/empty.ts', s: {}, b: {}, f: {} } };
    const result = parseCoverageFinal(JSON.stringify(data));
    expect(result.files[0].statements).toBe(0);
    expect(result.files[0].functions).toBe(0);
    expect(result.files[0].branches).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// lcov
// ---------------------------------------------------------------------------

describe('parseLcov', () => {
  const sampleLcov = [
    'TN:',
    'SF:src/a.ts',
    'FN:1,funcA',
    'FN:5,funcB',
    'FNDA:3,funcA',
    'FNDA:0,funcB',
    'FNF:2',
    'FNH:1',
    'DA:1,1',
    'DA:2,1',
    'DA:3,0',
    'DA:4,0',
    'LF:4',
    'LH:2',
    'BRF:4',
    'BRH:3',
    'end_of_record',
  ].join('\n');

  it('parses file path', () => {
    const result = parseLcov(sampleLcov);
    expect(result.files[0].path).toBe('src/a.ts');
  });

  it('parses line coverage', () => {
    const result = parseLcov(sampleLcov);
    expect(result.files[0].lines).toBe(50); // 2/4
  });

  it('parses function coverage', () => {
    const result = parseLcov(sampleLcov);
    expect(result.files[0].functions).toBe(50); // 1/2
  });

  it('parses branch coverage', () => {
    const result = parseLcov(sampleLcov);
    expect(result.files[0].branches).toBe(75); // 3/4
  });

  it('aggregates summary across all files', () => {
    const result = parseLcov(sampleLcov);
    expect(result.summary.lines).toBe(50);
    expect(result.summary.functions).toBe(50);
    expect(result.summary.branches).toBe(75);
  });

  it('returns zero summary for empty input', () => {
    const result = parseLcov('');
    expect(result.summary).toEqual({ lines: 0, statements: 0, functions: 0, branches: 0 });
    expect(result.files).toHaveLength(0);
  });

  it('handles multiple records', () => {
    const multiLcov = [
      'SF:src/a.ts',
      'LF:4',
      'LH:2',
      'FNF:2',
      'FNH:1',
      'BRF:4',
      'BRH:3',
      'end_of_record',
      'SF:src/b.ts',
      'LF:10',
      'LH:10',
      'FNF:4',
      'FNH:4',
      'BRF:8',
      'BRH:8',
      'end_of_record',
    ].join('\n');
    const result = parseLcov(multiLcov);
    expect(result.files).toHaveLength(2);
    // aggregate: LH=12, LF=14 → ~85.71%
    expect(result.summary.lines).toBeCloseTo(85.71, 1);
  });
});

// ---------------------------------------------------------------------------
// parseByFormat dispatcher
// ---------------------------------------------------------------------------

describe('parseByFormat', () => {
  it('routes coverage-summary format', () => {
    const data = {
      total: {
        lines: { pct: 80 },
        statements: { pct: 75 },
        functions: { pct: 70 },
        branches: { pct: 65 },
      },
    };
    const result = parseByFormat(JSON.stringify(data), 'coverage-summary');
    expect(result.summary.lines).toBe(80);
  });

  it('routes coverage-final format', () => {
    const result = parseByFormat(JSON.stringify({}), 'coverage-final');
    expect(result.summary.lines).toBe(0);
  });

  it('routes lcov format', () => {
    const result = parseByFormat('', 'lcov');
    expect(result.summary.lines).toBe(0);
  });
});
