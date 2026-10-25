import { describe, expect, it } from 'vitest';
import { rankProjects } from './projectSearch';

const project = (name: string, path = `/work/${name}`) => ({ name, path });

const names = (query: string, list: { name: string; path: string }[]) =>
  rankProjects(list, query).map((match) => match.item.name);

describe('rankProjects', () => {
  const list = [
    project('map-tools'),
    project('alpha-project'),
    project('api-gateway'),
    project('docs-site'),
  ];

  it('keeps the given order for an empty or blank query', () => {
    expect(names('', list)).toEqual(['map-tools', 'alpha-project', 'api-gateway', 'docs-site']);
    expect(names('   ', list)).toEqual(names('', list));
  });

  it('drops projects whose name and path do not hold the query as a subsequence', () => {
    expect(names('docs', list)).toEqual(['docs-site']);
    expect(names('zzz', list)).toEqual([]);
  });

  it('ranks a prefix over a contiguous run over scattered letters', () => {
    const ranked = [project('banshee-plain'), project('the-rapid-one'), project('apiary')];
    expect(names('api', ranked)).toEqual(['apiary', 'the-rapid-one', 'banshee-plain']);
  });

  it('treats word starts as strong as a prefix, so initials find a project', () => {
    expect(names('ag', list)[0]).toBe('api-gateway');
  });

  it('ignores case', () => {
    expect(names('DOCS', list)).toEqual(['docs-site']);
  });

  it('ignores spaces in the query', () => {
    expect(names('api gate', list)).toEqual(['api-gateway']);
  });

  it('matches the path too, but below any name match', () => {
    const withPaths = [
      project('frontend', '/clients/northwind/frontend'),
      project('north-star', '/work/north-star'),
    ];
    expect(names('north', withPaths)).toEqual(['north-star', 'frontend']);
    const [pathOnly] = rankProjects([withPaths[0]], 'north');
    expect(pathOnly.nameIndices).toEqual([]);
  });

  it('returns the matched name offsets for highlighting', () => {
    const [match] = rankProjects([project('docs-site')], 'dsi');
    expect(match.nameIndices).toEqual([0, 5, 6]);
  });

  it('keeps the given order between equal scores', () => {
    expect(names('same', [project('same', '/a/same'), project('same', '/b/same')])).toHaveLength(2);
    const ranked = rankProjects([project('one', '/a/x'), project('one', '/b/x')], 'one');
    expect(ranked.map((m) => m.item.path)).toEqual(['/a/x', '/b/x']);
  });
});
