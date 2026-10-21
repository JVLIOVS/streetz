/** Versioned local save. The same JSON shape will later be sent to an online account API. */
export interface SaveData {
  version: 1;
  settings: { quality: 'low' | 'medium' | 'high' };
  progress: { money: number };
}

const KEY = 'streetz.save';

export function defaultSave(): SaveData {
  return { version: 1, settings: { quality: 'medium' }, progress: { money: 500 } };
}

export function loadSave(storage: Pick<Storage, 'getItem'> | null = safeStorage()): SaveData {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return defaultSave();
    const data = JSON.parse(raw);
    if (data?.version !== 1) return defaultSave();
    return { ...defaultSave(), ...data, settings: { ...defaultSave().settings, ...data.settings } };
  } catch {
    return defaultSave();
  }
}

export function writeSave(data: SaveData, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(data));
  } catch {
    /* private mode / quota: the game keeps running without saving */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
