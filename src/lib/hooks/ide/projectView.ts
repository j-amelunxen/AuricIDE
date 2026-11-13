import { resetProjectState } from '@/lib/store/projectSession';
import type { IDEState } from './liveIDEState';

/**
 * Drops what the page shows of the project being left: the store's project
 * state and the open viewer. Opening another project and closing this one both
 * go through here, so neither can keep something the other clears.
 */
export function resetProjectView(state: IDEState): void {
  resetProjectState(state);
  state.setEditorContent('');
  state.setImageData(null);
  state.setVideoSrc(null);
  state.setPdfData(null);
  state.setMindmapData(null);
}
