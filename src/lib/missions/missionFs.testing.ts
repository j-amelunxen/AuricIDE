import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import type { MissionFs } from './missionMemory';

/** Fixture missions on disk, read by tests of the reader and the goal panel. */
export const MISSION_FIXTURES = path.join(import.meta.dirname, '__fixtures__');

/** The real disk, shaped like the Tauri fs wrappers the IDE passes in. */
export const diskMissionFs: MissionFs = {
  async readDirectory(dir) {
    const entries = await nodeFs.readdir(dir, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      path: path.join(dir, e.name),
      isDirectory: e.isDirectory(),
    }));
  },
  readFile: (file) => nodeFs.readFile(file, 'utf8'),
};
