import '@testing-library/jest-dom/vitest';

// Node 25 defines its own `localStorage`/`sessionStorage` globals, but leaves
// them inert unless the process was started with `--localstorage-file`. That
// inert object wins over the one jsdom installs on the window, so every test
// that stores or clears anything gets a bare `{}` and dies on the first method
// call. Swap in a real Web Storage implementation whenever the ambient one is
// missing its API; a future Node or jsdom that hands us a working Storage keeps
// it untouched.
class MemoryStorage implements Storage {
  private entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.entries.get(String(key)) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(String(key), String(value));
  }

  removeItem(key: string): void {
    this.entries.delete(String(key));
  }

  clear(): void {
    this.entries.clear();
  }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (typeof globalThis[name]?.getItem !== 'function') {
    Object.defineProperty(globalThis, name, {
      value: new MemoryStorage(),
      configurable: true,
      writable: true,
    });
  }
}

// jsdom implements no layout, so it ships no scrollIntoView. Components that
// keep a view pinned to its newest content call it on every update; without a
// stub the component crashes in tests for a reason that has nothing to do with
// the behaviour under test.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
