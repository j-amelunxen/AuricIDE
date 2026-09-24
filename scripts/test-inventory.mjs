import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const BUCKET_NAMES = ['unit', 'component', 'store', 'e2e', 'rust'];
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.turbo',
  '.codegraph',
  'node_modules',
  'coverage',
  'dist',
  'build',
  'target',
]);
const JAVASCRIPT_TEST_FILE = /(?:\.(?:test|spec)|\/(?:__tests__|tests)\/).*\.[cm]?[jt]sx?$/i;
const RUST_TEST_FILE = /(?:_tests?\.rs$|\/(?:tests?|test)\/.*\.rs$)/i;
const JAVASCRIPT_TEST_CASE = /\b(?:it|test)(?:\.(?:skip|only|todo|concurrent|each))*\s*\(/g;
const RUST_TEST_CASE = /#\s*\[\s*(?:[\w:]+::)*test(?:\s*\([^\]]*\))?\s*\]/g;
const JAVASCRIPT_MOCK = /\b(?:vi|jest)\.(?:mock|fn|spyOn)\s*\(/g;
const RUST_MOCK = /\b(?:mockall::automock!?|mock!|mockito::\w+)/g;

/**
 * Generate a deterministic test baseline for a repository.
 *
 * The scanner intentionally uses simple textual heuristics: it is dependency-free
 * and reports files whose location gives no confident bucket as "unknown".
 */
export async function generateTestInventory(rootDirectory = process.cwd()) {
  const root = resolve(rootDirectory);
  const paths = await collectFiles(root);
  const files = [];

  for (const absolutePath of paths) {
    const path = relative(root, absolutePath).split(sep).join('/');
    const content = await readFile(absolutePath, 'utf8');
    if (!isTestFile(path, content)) continue;

    const bucket = classify(path, content);
    files.push({
      path,
      bucket: bucket.name,
      testCaseCount: countTestCases(path, content),
      mockCount: countMocks(path, content),
      ...(bucket.reason ? { classificationReason: bucket.reason } : {}),
    });
  }

  files.sort((left, right) => comparePaths(left.path, right.path));

  const buckets = Object.fromEntries(
    BUCKET_NAMES.map((name) => [name, { files: [], testCaseCount: 0, mockCount: 0 }])
  );
  const unknownFiles = [];

  for (const file of files) {
    if (file.bucket === 'unknown') {
      unknownFiles.push({ path: file.path, reason: file.classificationReason });
      continue;
    }

    const bucket = buckets[file.bucket];
    bucket.files.push(file.path);
    bucket.testCaseCount += file.testCaseCount;
    bucket.mockCount += file.mockCount;
  }

  for (const bucket of Object.values(buckets)) {
    bucket.fileCount = bucket.files.length;
  }

  const unknownClassification = {
    fileCount: unknownFiles.length,
    testCaseCount: files
      .filter((file) => file.bucket === 'unknown')
      .reduce((total, file) => total + file.testCaseCount, 0),
    files: unknownFiles,
  };
  const baseline = {
    testFileCount: files.length,
    testCaseCount: files.reduce((total, file) => total + file.testCaseCount, 0),
    mockCount: files.reduce((total, file) => total + file.mockCount, 0),
    unknownClassification: {
      fileCount: unknownClassification.fileCount,
      testCaseCount: unknownClassification.testCaseCount,
    },
  };

  return { baseline, buckets, unknownClassification, files };
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];

  for (const entry of entries.sort((left, right) => comparePaths(left.name, right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) paths.push(...(await collectFiles(path)));
    } else if (entry.isFile()) {
      paths.push(path);
    }
  }

  return paths;
}

function isTestFile(path, content) {
  if (path.endsWith('.rs')) {
    return RUST_TEST_FILE.test(path) || RUST_TEST_CASE.test(content);
  }
  return JAVASCRIPT_TEST_FILE.test(path);
}

function classify(path, content) {
  if (path.endsWith('.rs')) return { name: 'rust' };
  if (
    /(?:^|\/)(?:e2e|playwright)(?:\/|$)/i.test(path) ||
    /\.e2e\.[cm]?[jt]sx?$/i.test(path) ||
    /@playwright\/test/.test(content)
  ) {
    return { name: 'e2e' };
  }
  if (/(?:^|\/)store(?:\/|$)/i.test(path) || /(?:Slice|Store)\.test\.[cm]?[jt]sx?$/i.test(path)) {
    return { name: 'store' };
  }
  if (/(?:^|\/)components?(?:\/|$)/i.test(path) || path.endsWith('.test.tsx')) {
    return { name: 'component' };
  }
  if (/^(?:scripts\/|src\/|e2e\/)/.test(path)) return { name: 'unit' };
  return { name: 'unknown', reason: 'No recognised test area' };
}

function countTestCases(path, content) {
  return countMatches(path.endsWith('.rs') ? RUST_TEST_CASE : JAVASCRIPT_TEST_CASE, content);
}

function countMocks(path, content) {
  return countMatches(path.endsWith('.rs') ? RUST_MOCK : JAVASCRIPT_MOCK, content);
}

function countMatches(pattern, content) {
  pattern.lastIndex = 0;
  let count = 0;
  while (pattern.exec(content)) count += 1;
  return count;
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseArguments(argumentsList) {
  let json = false;
  let root = process.cwd();

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--json') json = true;
    else if (argument === '--root') {
      root = argumentsList[index + 1];
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      return { help: true };
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!root) throw new Error('--root requires a directory');
  return { json, root };
}

function formatHumanReadable(inventory) {
  const lines = [
    'Test inventory',
    `Baseline: ${inventory.baseline.testFileCount} files, ${inventory.baseline.testCaseCount} test cases, ${inventory.baseline.mockCount} mocks`,
  ];

  for (const name of BUCKET_NAMES) {
    const bucket = inventory.buckets[name];
    lines.push(
      `${name}: ${bucket.fileCount} files, ${bucket.testCaseCount} test cases, ${bucket.mockCount} mocks`
    );
  }

  lines.push(
    `unknown classification: ${inventory.unknownClassification.fileCount} files, ${inventory.unknownClassification.testCaseCount} test cases`
  );
  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Usage: node scripts/test-inventory.mjs [--json] [--root <directory>]\n');
    return;
  }

  const inventory = await generateTestInventory(options.root);
  process.stdout.write(
    options.json ? `${JSON.stringify(inventory, null, 2)}\n` : formatHumanReadable(inventory)
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`test-inventory: ${error.message}\n`);
    process.exitCode = 1;
  });
}
