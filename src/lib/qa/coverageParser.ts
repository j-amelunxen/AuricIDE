export type CoverageFormat = 'coverage-summary' | 'coverage-final' | 'lcov';

export interface CoveragePathConfig {
  relativePath: string;
  format: CoverageFormat;
}

export interface CoverageConfig {
  paths: CoveragePathConfig[];
}

export interface CoverageSummary {
  lines: number;
  statements: number;
  functions: number;
  branches: number;
}

export interface FileCoverage {
  path: string;
  size: number;
  lines: number;
  statements: number;
  functions: number;
  branches: number;
}

export interface ParsedCoverage {
  summary: CoverageSummary;
  files: FileCoverage[];
}

// ---------------------------------------------------------------------------
// coverage-summary (Vitest / Jest / nyc)
// ---------------------------------------------------------------------------

export function parseCoverageSummary(content: string): ParsedCoverage {
  const data = JSON.parse(content);
  const total = data.total;

  const summary: CoverageSummary = {
    lines: total.lines.pct,
    statements: total.statements.pct,
    functions: total.functions.pct,
    branches: total.branches.pct,
  };

  const files: FileCoverage[] = Object.keys(data)
    .filter((key) => key !== 'total')
    .map((path) => ({
      path,
      size: data[path].statements?.total ?? data[path].lines?.total ?? 0,
      lines: data[path].lines.pct,
      statements: data[path].statements.pct,
      functions: data[path].functions.pct,
      branches: data[path].branches.pct,
    }));

  return { summary, files };
}

// ---------------------------------------------------------------------------
// coverage-final (Istanbul / nyc raw output)
// ---------------------------------------------------------------------------

export function parseCoverageFinal(content: string): ParsedCoverage {
  const data: Record<
    string,
    { s?: Record<string, number>; b?: Record<string, number[]>; f?: Record<string, number> }
  > = JSON.parse(content);

  const files: FileCoverage[] = Object.entries(data).map(([filePath, fd]) => {
    const sValues = Object.values(fd.s ?? {});
    const totalStatements = sValues.length;
    const coveredStatements = sValues.filter((v) => v > 0).length;
    const statementsPct = totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 0;

    const fValues = Object.values(fd.f ?? {});
    const totalFunctions = fValues.length;
    const coveredFunctions = fValues.filter((v) => v > 0).length;
    const functionsPct = totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 0;

    const allBranches = Object.values(fd.b ?? {}).flat();
    const totalBranches = allBranches.length;
    const coveredBranches = allBranches.filter((v) => v > 0).length;
    const branchesPct = totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 0;

    return {
      path: filePath,
      size: totalStatements,
      lines: statementsPct,
      statements: statementsPct,
      functions: functionsPct,
      branches: branchesPct,
    };
  });

  if (files.length === 0) {
    return { summary: { lines: 0, statements: 0, functions: 0, branches: 0 }, files: [] };
  }

  // Weighted totals (same approach as lcov) – more accurate than per-file average
  const entries = Object.values(data);
  const totalS = entries.reduce((n, fd) => n + Object.keys(fd.s ?? {}).length, 0);
  const covS = entries.reduce(
    (n, fd) => n + Object.values(fd.s ?? {}).filter((v) => v > 0).length,
    0
  );
  const totalF = entries.reduce((n, fd) => n + Object.keys(fd.f ?? {}).length, 0);
  const covF = entries.reduce(
    (n, fd) => n + Object.values(fd.f ?? {}).filter((v) => v > 0).length,
    0
  );
  const totalB = entries.reduce((n, fd) => n + Object.values(fd.b ?? {}).flat().length, 0);
  const covB = entries.reduce(
    (n, fd) =>
      n +
      Object.values(fd.b ?? {})
        .flat()
        .filter((v) => v > 0).length,
    0
  );

  const pct = (covered: number, total: number) => (total > 0 ? (covered / total) * 100 : 0);

  const summary: CoverageSummary = {
    lines: pct(covS, totalS),
    statements: pct(covS, totalS),
    functions: pct(covF, totalF),
    branches: pct(covB, totalB),
  };

  return { summary, files };
}

// ---------------------------------------------------------------------------
// lcov
// ---------------------------------------------------------------------------

interface LcovFileRaw {
  path: string;
  lf: number;
  lh: number;
  fnf: number;
  fnh: number;
  brf: number;
  brh: number;
}

export function parseLcov(content: string): ParsedCoverage {
  const rawFiles: LcovFileRaw[] = [];
  let current: Partial<LcovFileRaw> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('SF:')) {
      current = { path: trimmed.slice(3), lf: 0, lh: 0, fnf: 0, fnh: 0, brf: 0, brh: 0 };
    } else if (trimmed.startsWith('LF:')) {
      current.lf = parseInt(trimmed.slice(3), 10);
    } else if (trimmed.startsWith('LH:')) {
      current.lh = parseInt(trimmed.slice(3), 10);
    } else if (trimmed.startsWith('FNF:')) {
      current.fnf = parseInt(trimmed.slice(4), 10);
    } else if (trimmed.startsWith('FNH:')) {
      current.fnh = parseInt(trimmed.slice(4), 10);
    } else if (trimmed.startsWith('BRF:')) {
      current.brf = parseInt(trimmed.slice(4), 10);
    } else if (trimmed.startsWith('BRH:')) {
      current.brh = parseInt(trimmed.slice(4), 10);
    } else if (trimmed === 'end_of_record' && current.path) {
      rawFiles.push(current as LcovFileRaw);
      current = {};
    }
  }

  if (rawFiles.length === 0) {
    return { summary: { lines: 0, statements: 0, functions: 0, branches: 0 }, files: [] };
  }

  const files: FileCoverage[] = rawFiles.map((f) => ({
    path: f.path,
    size: f.lf,
    lines: f.lf > 0 ? (f.lh / f.lf) * 100 : 0,
    statements: f.lf > 0 ? (f.lh / f.lf) * 100 : 0,
    functions: f.fnf > 0 ? (f.fnh / f.fnf) * 100 : 0,
    branches: f.brf > 0 ? (f.brh / f.brf) * 100 : 0,
  }));

  const totalLf = rawFiles.reduce((s, f) => s + f.lf, 0);
  const totalLh = rawFiles.reduce((s, f) => s + f.lh, 0);
  const totalFnf = rawFiles.reduce((s, f) => s + f.fnf, 0);
  const totalFnh = rawFiles.reduce((s, f) => s + f.fnh, 0);
  const totalBrf = rawFiles.reduce((s, f) => s + f.brf, 0);
  const totalBrh = rawFiles.reduce((s, f) => s + f.brh, 0);

  const summary: CoverageSummary = {
    lines: totalLf > 0 ? (totalLh / totalLf) * 100 : 0,
    statements: totalLf > 0 ? (totalLh / totalLf) * 100 : 0,
    functions: totalFnf > 0 ? (totalFnh / totalFnf) * 100 : 0,
    branches: totalBrf > 0 ? (totalBrh / totalBrf) * 100 : 0,
  };

  return { summary, files };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function parseByFormat(content: string, format: CoverageFormat): ParsedCoverage {
  switch (format) {
    case 'coverage-summary':
      return parseCoverageSummary(content);
    case 'coverage-final':
      return parseCoverageFinal(content);
    case 'lcov':
      return parseLcov(content);
  }
}
