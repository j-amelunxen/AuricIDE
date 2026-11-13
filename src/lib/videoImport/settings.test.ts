import { describe, expect, it } from 'vitest';
import fixture from './videoImportSettings.fixtures.json';
import {
  VIDEO_IMPORT_DEFAULTS,
  VIDEO_IMPORT_SETTINGS_NS,
  VIDEO_IMPORT_SETTING_KEYS,
  visionEnabledFrom,
} from './settings';

// Rust reads the same namespace, keys and defaults (src-tauri/src/video_import);
// a key the settings screen writes but Rust never reads is a setting that does nothing.
describe('video import settings', () => {
  it('uses the namespace and exactly the keys of the shared fixture', () => {
    expect(VIDEO_IMPORT_SETTINGS_NS).toBe(fixture.namespace);
    expect(Object.values(VIDEO_IMPORT_SETTING_KEYS).sort()).toEqual(
      Object.keys(fixture.defaults).sort()
    );
  });

  it('starts every field at the default Rust falls back to', () => {
    for (const [field, key] of Object.entries(VIDEO_IMPORT_SETTING_KEYS)) {
      const value = VIDEO_IMPORT_DEFAULTS[field as keyof typeof VIDEO_IMPORT_DEFAULTS];
      expect(String(value), key).toBe(fixture.defaults[key as keyof typeof fixture.defaults]);
    }
  });

  it('keeps vision on unless the project stored false', () => {
    expect(visionEnabledFrom(null)).toBe(true);
    expect(visionEnabledFrom('true')).toBe(true);
    expect(visionEnabledFrom('false')).toBe(false);
  });
});
