import { invoke } from './invoke';

/**
 * Fallback to copy text via document.execCommand('copy').
 * Used when neither Tauri IPC nor the asynchronous navigator.clipboard API
 * is available or when navigator.clipboard throws (e.g. Document is not focused).
 */
export function copyViaExecCommand(text: string): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.width = '1px';
    textarea.style.height = '1px';
    textarea.style.padding = '0';
    textarea.style.border = 'none';
    textarea.style.outline = 'none';
    textarea.style.boxShadow = 'none';
    textarea.style.background = 'transparent';
    textarea.style.opacity = '0';
    textarea.setAttribute('readonly', '');
    textarea.setAttribute('aria-hidden', 'true');
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const successful = document.execCommand('copy');
    document.body.removeChild(textarea);
    return Boolean(successful);
  } catch {
    return false;
  }
}

/**
 * Copies text to the system clipboard using a multi-tiered strategy:
 * 1. Native Tauri IPC (`clipboard_write_text`) if available — reliable across the desktop app,
 *    independent of WebKit document focus, gesture timeouts, or unmounted DOM nodes.
 * 2. `navigator.clipboard.writeText` — modern asynchronous Clipboard API.
 * 3. `document.execCommand('copy')` — synchronous fallback if navigator.clipboard fails
 *    or the webview document is considered unfocused by WebKit.
 *
 * Returns `true` if copying succeeded by any method, `false` otherwise.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Strategy 1: Native Tauri IPC (preferred in the desktop app)
  try {
    await invoke<void>('clipboard_write_text', { text });
    return true;
  } catch {
    // Tauri IPC unavailable (browser mode, tests) or failed — proceed to web APIs
  }

  // Strategy 2: Modern Clipboard API
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      // If document is not focused, try to refocus window before calling writeText
      if (
        typeof document !== 'undefined' &&
        typeof window !== 'undefined' &&
        document.hasFocus &&
        !document.hasFocus()
      ) {
        try {
          window.focus();
        } catch {
          // ignore focus error
        }
      }
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Async writeText failed (e.g. DOMException: Document is not focused)
    }
  }

  // Strategy 3: Legacy execCommand fallback
  if (copyViaExecCommand(text)) {
    return true;
  }

  return false;
}

/**
 * Reads text from the system clipboard:
 * 1. Tauri IPC (`clipboard_read_text`) if available.
 * 2. `navigator.clipboard.readText` fallback.
 * Returns empty string on failure.
 */
export async function readClipboardText(): Promise<string> {
  try {
    return await invoke<string>('clipboard_read_text');
  } catch {
    // Fall back to web Clipboard API
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
    try {
      const text = await navigator.clipboard.readText();
      return text ?? '';
    } catch {
      // Read failed or permission denied
    }
  }

  return '';
}
