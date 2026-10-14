import { useEffect, useState } from 'react';

/**
 * True while the Alt/Option key is held. Blur releases it: the keyup of a key
 * let go in another window never reaches this one, and the state would stick.
 */
export function useAltHeld(): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const sync = (event: KeyboardEvent) => setHeld(event.altKey);
    const release = () => setHeld(false);
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', release);
    };
  }, []);

  return held;
}
