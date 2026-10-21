import { useEffect } from 'react';
import { showGraph } from '@/lib/git/graphEntry';

/**
 * ⌥⌘G opens the git graph. The key is read by position (`code`): with Option
 * held, macOS types "©" instead of "g".
 */
export function useShowGraphShortcut() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const exactChord = event.metaKey && event.altKey && !event.shiftKey && !event.ctrlKey;
      if (!exactChord || event.code !== 'KeyG') return;
      event.preventDefault();
      showGraph();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
