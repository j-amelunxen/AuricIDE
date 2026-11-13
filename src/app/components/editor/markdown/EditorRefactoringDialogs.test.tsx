import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { EditorRefactoringDialogs } from './EditorRefactoringDialogs';

const disk = vi.hoisted(() => ({
  files: new Map<string, string>(),
  readOnly: new Set<string>(),
}));
vi.mock('@/lib/tauri/fs', () => ({
  readFile: vi.fn(async (path: string) => {
    const content = disk.files.get(path);
    if (content === undefined) throw new Error(`missing ${path}`);
    return content;
  }),
  writeFile: vi.fn(async (path: string, content: string) => {
    if (disk.readOnly.has(path)) throw new Error('read-only');
    disk.files.set(path, content);
  }),
}));

const SOURCE = '# Doc\n\n## Part\n\nBody text.\n';

function renderDialogs(props: Partial<Parameters<typeof EditorRefactoringDialogs>[0]>) {
  const onChange = vi.fn();
  render(
    <EditorRefactoringDialogs
      renameDialog={null}
      onCloseRenameDialog={vi.fn()}
      extractDialog={null}
      onCloseExtractDialog={vi.fn()}
      content={SOURCE}
      filePath="/notes/doc.md"
      onChange={onChange}
      viewRef={{ current: null }}
      {...props}
    />
  );
  return { onChange };
}

describe('EditorRefactoringDialogs', () => {
  beforeEach(() => {
    disk.files = new Map();
    disk.readOnly = new Set();
    useStore.setState({ toasts: [], allFilePaths: [] });
  });

  it('keeps the section in place and says so when the new file cannot be written', async () => {
    const user = userEvent.setup();
    disk.files.set('/notes/doc.md', SOURCE);
    disk.readOnly.add('/notes/part.md');
    const { onChange } = renderDialogs({
      extractDialog: { title: 'Part', suggestedFileName: 'part.md', contentPreview: '', line: 3 },
    });

    await user.click(screen.getByRole('button', { name: 'Extract' }));

    await waitFor(() => expect(useStore.getState().toasts).toHaveLength(1));
    expect(useStore.getState().toasts[0].message).toContain('Could not extract the section');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renames a heading in the open file and in the files linking to it, naming one it could not write', async () => {
    const user = userEvent.setup();
    disk.files.set('/notes/a.md', 'See [[doc#Part]].\n');
    disk.files.set('/notes/b.md', 'Also [[doc#Part]].\n');
    disk.readOnly.add('/notes/b.md');
    useStore.setState({ allFilePaths: ['/notes/doc.md', '/notes/a.md', '/notes/b.md'] });
    const { onChange } = renderDialogs({
      renameDialog: { title: 'Part', line: 3, refCount: 2 },
    });

    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Chapter');
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0][0]).toContain('## Chapter');
    expect(disk.files.get('/notes/a.md')).toContain('[[doc#Chapter]]');
    expect(useStore.getState().toasts[0].message).toContain('b.md');
  });
});
