// Small key-value storage kept on the device (the last known user, the offline copy of what
// the home shows, the outbox). Native: SQLite (under the OS's file protection); web:
// localStorage. Every call fails soft: no storage means the app still works, just not offline.
import { Platform } from "react-native";

type Kv = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(prefix: string): string[];
};

function webKv(): Kv {
  return {
    get: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* blocked or full */
      }
    },
    remove: (k) => {
      try {
        localStorage.removeItem(k);
      } catch {
        /* fine */
      }
    },
    keys: (prefix) => {
      try {
        return Object.keys(localStorage).filter((k) => k.startsWith(prefix));
      } catch {
        return [];
      }
    },
  };
}

function nativeKv(): Kv {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native only
  const { Storage } = require("expo-sqlite/kv-store") as typeof import("expo-sqlite/kv-store");
  return {
    get: (k) => {
      try {
        return Storage.getItemSync(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        Storage.setItemSync(k, v);
      } catch {
        /* fine */
      }
    },
    remove: (k) => {
      try {
        Storage.removeItemSync(k);
      } catch {
        /* fine */
      }
    },
    keys: (prefix) => {
      try {
        return Storage.getAllKeysSync().filter((k) => k.startsWith(prefix));
      } catch {
        return [];
      }
    },
  };
}

export const kv: Kv = Platform.OS === "web" ? webKv() : nativeKv();

export function readJson<T>(key: string): T | null {
  const raw = kv.get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
export const writeJson = (key: string, value: unknown) => kv.set(key, JSON.stringify(value));
