import type { ExtractSectionResult } from './extractSection';

/**
 * Apply a section extraction: create a new file with the section content,
 * and replace the section in the source file with a wiki-link.
 *
 * @param sourceFilePath - Absolute path to the source markdown file
 * @param extraction - The computed extraction result
 * @param targetFileName - The filename for the new file (just the name, not full path)
 * @param readFile - Async function to read a file's contents
 * @param writeFile - Async function to write content to a file
 * @returns The full path of the newly created file
 */
export async function applyExtractSection(
  sourceFilePath: string,
  extraction: ExtractSectionResult,
  targetFileName: string,
  readFile: (path: string) => Promise<string>,
  writeFile: (path: string, content: string) => Promise<void>
): Promise<string> {
  const sourceContent = await readFile(sourceFilePath);

  // Compute the directory of the source file
  const lastSlash = sourceFilePath.lastIndexOf('/');
  const sourceDir = lastSlash >= 0 ? sourceFilePath.slice(0, lastSlash) : '.';
  const newFilePath = `${sourceDir}/${targetFileName}`;

  // Replace the section in the source with the wiki-link
  const updatedSource =
    sourceContent.slice(0, extraction.sectionFrom) +
    extraction.replacementText +
    sourceContent.slice(extraction.sectionTo);

  // Write both files
  await writeFile(newFilePath, extraction.sectionContent);
  await writeFile(sourceFilePath, updatedSource);

  return newFilePath;
}
