import { useStore } from '@/lib/store';
import {
  lintConfigFacet,
  fileListForLintFacet,
  headingIndexForLintFacet,
  currentFilePathFacet,
} from '@/lib/editor/markdownLintExtension';
import { jsonLintExtension, currentFilePathFacetJson } from '@/lib/editor/jsonLintExtension';
import { xmlLintExtension, currentFilePathFacetXml } from '@/lib/editor/xmlLintExtension';
import { yamlLintExtension, currentFilePathFacetYaml } from '@/lib/editor/yamlLintExtension';
import { getLintableFileType, buildHeadingTitleIndex } from '@/lib/editor/setup';

export function buildLintReconfiguration(
  fileType: ReturnType<typeof getLintableFileType>,
  filePath?: string
) {
  switch (fileType) {
    case 'markdown':
      return [
        lintConfigFacet.of(useStore.getState().lintConfig),
        fileListForLintFacet.of(useStore.getState().allFilePaths),
        headingIndexForLintFacet.of(buildHeadingTitleIndex()),
        currentFilePathFacet.of(filePath ?? ''),
      ];
    case 'json':
      return [jsonLintExtension, currentFilePathFacetJson.of(filePath ?? '')];
    case 'xml':
      return [xmlLintExtension, currentFilePathFacetXml.of(filePath ?? '')];
    case 'yaml':
      return [yamlLintExtension, currentFilePathFacetYaml.of(filePath ?? '')];
    default:
      return [];
  }
}
