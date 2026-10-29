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

const raw: Kv = Platform.OS === "web" ? webKv() : nativeKv();

// Each account on this device keeps its own copy (the account switcher, chats-home.md 7): the
// person's keys ("gigspree:…", everything cleared at sign-out) are stored under the account
// that is open ("gigspree@<user id>:…"), so switching shows that account's things, offline too,
// and nothing of one account shows in another. Other keys belong to the device.
const OWN = "gigspree:";
const ACTIVE = "accounts:open";
/** Where the open account is kept (another browser tab watches it). */
export const OPEN_ACCOUNT_KEY = ACTIVE;
let open: string | null = raw.get(ACTIVE);
const home = (userId: string) => `gigspree@${userId}:`;
const place = (k: string) => (open && k.startsWith(OWN) ? home(open) + k.slice(OWN.length) : k);
const unplace = (k: string) => (open && k.startsWith(home(open)) ? OWN + k.slice(home(open).length) : k);

export const kv: Kv = {
  get: (k) => raw.get(place(k)),
  set: (k, v) => raw.set(place(k), v),
  remove: (k) => raw.remove(place(k)),
  keys: (prefix) => raw.keys(place(prefix)).map(unplace),
};

/** The account whose copy is open on this device (null: nobody signed in yet). */
export const openAccountId = () => open;

/**
 * Opens an account's copy. The first account on a device takes what was kept before accounts
 * had their own copies (an update from an older app), so nothing waiting to be sent is lost.
 */
/**
 * Things kept in memory for the open account (a card's lists, live cards as last loaded) clear
 * themselves here when another account's copy opens: redrawing the screens doesn't reach them.
 */
const forgetters = new Set<() => void>();
export const forgetOnSwitch = (f: () => void) => void forgetters.add(f);

export function openAccountCopy(userId: string | null) {
  if (userId === open) return;
  forgetters.forEach((f) => f());
  if (userId && !open)
    for (const k of raw.keys(OWN)) {
      const v = raw.get(k);
      if (v !== null) raw.set(home(userId) + k.slice(OWN.length), v);
      raw.remove(k);
    }
  open = userId;
  if (userId) raw.set(ACTIVE, userId);
  else raw.remove(ACTIVE);
}

/** One key of another account's copy, read without opening it (what it has waiting to send). */
export function readAccountJson<T>(userId: string, key: string): T | null {
  const v = raw.get(key.startsWith(OWN) ? home(userId) + key.slice(OWN.length) : key);
  if (v === null) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

/** Removes every account's copy (signed out of all). */
export function forgetAllAccounts() {
  for (const k of raw.keys("gigspree@")) raw.remove(k);
}

/** Removes everything kept for an account on this device (signed out of it). */
export function forgetAccount(userId: string) {
  for (const k of raw.keys(home(userId))) raw.remove(k);
}

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
