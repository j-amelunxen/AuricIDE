import type { EditorView } from '@codemirror/view';
import { useStore } from '@/lib/store';
import { computeHeadingRenameChanges } from '@/lib/refactoring/renameHeading';
import { applyChangesToContent } from '@/lib/refactoring/applyRenameChanges';
import { computeSectionExtraction } from '@/lib/refactoring/extractSection';
import { applyExtractSection } from '@/lib/refactoring/applyExtractSection';
import { RenameHeadingDialog } from '@/app/components/refactoring/RenameHeadingDialog';
import { ExtractSectionDialog } from '@/app/components/refactoring/ExtractSectionDialog';

interface RenameDialogState {
  title: string;
  line: number;
  refCount: number;
}

interface ExtractDialogState {
  title: string;
  suggestedFileName: string;
  contentPreview: string;
  line: number;
}

interface EditorRefactoringDialogsProps {
  renameDialog: RenameDialogState | null;
  onCloseRenameDialog: () => void;
  extractDialog: ExtractDialogState | null;
  onCloseExtractDialog: () => void;
  content: string;
  filePath?: string;
  onChange?: (content: string) => void;
  viewRef: React.RefObject<EditorView | null>;
}

export function EditorRefactoringDialogs({
  renameDialog,
  onCloseRenameDialog,
  extractDialog,
  onCloseExtractDialog,
  content,
  filePath,
  onChange,
  viewRef,
}: EditorRefactoringDialogsProps) {
  return (
    <>
      {renameDialog && (
        <RenameHeadingDialog
          oldTitle={renameDialog.title}
          referenceCount={renameDialog.refCount}
          onCancel={onCloseRenameDialog}
          onConfirm={async (newTitle) => {
            const currentFile = filePath ?? '';
            const currentFileName = currentFile.split('/').pop() ?? '';
            try {
              const { readFile, writeFile } = await import('@/lib/tauri/fs');
              const allPaths = useStore.getState().allFilePaths;
              const workspace = new Map<string, string>();
              for (const p of allPaths) {
                if (p.endsWith('.md')) {
                  try {
                    const c = await readFile(p);
                    workspace.set(p, c);
                  } catch {}
                }
              }
              const changes = computeHeadingRenameChanges(
                currentFile,
                currentFileName,
                renameDialog.title,
                newTitle,
                workspace
              );
              const byFile = new Map<string, typeof changes>();
              for (const change of changes) {
                const list = byFile.get(change.filePath) ?? [];
                list.push(change);
                byFile.set(change.filePath, list);
              }
              for (const [fp, fileChanges] of byFile) {
                const original = workspace.get(fp) ?? '';
                const updated = applyChangesToContent(original, fileChanges);
                await writeFile(fp, updated);
                if (fp === currentFile && onChange) onChange(updated);
              }
            } catch {
              if (viewRef.current) {
                const doc = viewRef.current.state.doc.toString();
                const changes = computeHeadingRenameChanges(
                  currentFile,
                  currentFileName,
                  renameDialog.title,
                  newTitle,
                  new Map([[currentFile, doc]])
                );
                const updated = applyChangesToContent(doc, changes);
                if (onChange) onChange(updated);
              }
            }
            onCloseRenameDialog();
          }}
        />
      )}

      {extractDialog && (
        <ExtractSectionDialog
          headingTitle={extractDialog.title}
          suggestedFileName={extractDialog.suggestedFileName}
          contentPreview={extractDialog.contentPreview}
          onCancel={onCloseExtractDialog}
          onConfirm={async (fileName) => {
            const currentFile = filePath ?? '';
            const extraction = computeSectionExtraction(content, extractDialog.line);
            if (!extraction) {
              onCloseExtractDialog();
              return;
            }
            try {
              const { readFile, writeFile } = await import('@/lib/tauri/fs');
              await applyExtractSection(currentFile, extraction, fileName, readFile, writeFile);
              const updatedSource =
                content.slice(0, extraction.sectionFrom) +
                extraction.replacementText +
                content.slice(extraction.sectionTo);
              if (onChange) onChange(updatedSource);
            } catch {
              const updatedSource =
                content.slice(0, extraction.sectionFrom) +
                extraction.replacementText +
                content.slice(extraction.sectionTo);
              if (onChange) onChange(updatedSource);
            }
            onCloseExtractDialog();
          }}
        />
      )}
    </>
  );
}
