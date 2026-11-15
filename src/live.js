// Tiny live-state file so the Scam Arena UI can stream Kane steps and loop rounds.
import { STATE, writeJSON, readJSON } from './paths.js';
import path from 'node:path';

export const LIVE = path.join(STATE, 'live.json');

export function writeLive(state) {
  writeJSON(LIVE, { ...state, updatedAt: new Date().toISOString() });
}

export function readLive() {
  return readJSON(LIVE, null);
}

export function patchLive(partial) {
  const cur = readLive() || {};
  writeLive({ ...cur, ...partial });
}
