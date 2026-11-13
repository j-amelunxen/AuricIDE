import { isMarkdownPath } from '@/lib/markdown/markdownPath';
import type { EditorView } from '@codemirror/view';
import { useStore } from '@/lib/store';
import { computeHeadingRenameChanges } from '@/lib/refactoring/renameHeading';
import {
  applyChangesToContent,
  describeWorkspaceFailures,
  readWorkspaceFiles,
  writeWorkspaceChanges,
} from '@/lib/refactoring/applyRenameChanges';
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
            const { readFile, writeFile } = await import('@/lib/tauri/fs');
            const store = useStore.getState();
            const others = store.allFilePaths.filter((p) => isMarkdownPath(p) && p !== currentFile);
            const { contents, failed: unread } = await readWorkspaceFiles(others, readFile);
            // The open file is what the editor shows, unsaved edits included.
            const shown = viewRef.current?.state.doc.toString() ?? content;
            contents.set(currentFile, shown);
            const changes = computeHeadingRenameChanges(
              currentFile,
              currentFileName,
              renameDialog.title,
              newTitle,
              contents
            );
            const own = changes.filter((change) => change.filePath === currentFile);
            const { written, failed } = await writeWorkspaceChanges(
              changes.filter((change) => change.filePath !== currentFile),
              contents,
              writeFile
            );
            for (const [path, updated] of written) store.updateFileInIndex(path, updated);
            // The open file changes like any edit, and is saved like one.
            if (own.length > 0) onChange?.(applyChangesToContent(shown, own));
            const problem = describeWorkspaceFailures(`Renamed "${renameDialog.title}"`, [
              ...unread,
              ...failed,
            ]);
            if (problem) store.showToast(problem, 'error');
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
              onChange?.(
                content.slice(0, extraction.sectionFrom) +
                  extraction.replacementText +
                  content.slice(extraction.sectionTo)
              );
            } catch (error) {
              // Without the new file the section must stay where it is.
              const reason = error instanceof Error ? error.message : String(error);
              useStore.getState().showToast(`Could not extract the section: ${reason}`, 'error');
            }
            onCloseExtractDialog();
          }}
        />
      )}
    </>
  );
}
