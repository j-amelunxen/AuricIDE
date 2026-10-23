import { useStore, type StoreState } from '@/lib/store';

type TabActions = Pick<StoreState, 'closeWorkPlace' | 'selectFile' | 'openTab'>;

/**
 * Shows `path` in an editor tab and selects it, leaving any work place. The
 * actions default to the store's; a caller that holds its own copies passes them.
 */
export function openFileTab(path: string, actions: TabActions = useStore.getState()): void {
  actions.closeWorkPlace();
  actions.selectFile(path);
  actions.openTab({ id: path, path, name: path.split('/').pop() ?? path });
}
