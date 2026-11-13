import { Facet } from '@codemirror/state';

/** The open file's path, for every extension that reports or resolves against it. */
export const currentFilePathFacet = Facet.define<string, string>({
  combine: (values) => values[0] ?? '',
});

/** Every file of the project (the store's `allFilePaths`): completion, wiki links and lint. */
export const projectFilesFacet = Facet.define<string[], string[]>({
  combine: (values) => values[0] ?? [],
});
