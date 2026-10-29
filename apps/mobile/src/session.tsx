// The signed-in user. The last known user is kept on the device so the app opens instantly;
// the server check runs in the background and signs out if the session has ended. The device
// can stay signed in to several accounts (the account switcher, docs/design/chats-home.md 7):
// each keeps its own copy on the device (src/storage.ts), and switching sends what the open
// one has waiting first, so nothing is ever sent as someone else.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { router } from "expo-router";
import type { MeResponse } from "@assistant/shared";
import { ApiError, request } from "./api.ts";
import {
  deviceAccounts,
  keepThisAccount,
  openDeviceAccount,
  signOutOfAccount,
  signOut as authSignOut,
  type DeviceAccount,
} from "./auth.ts";
import {
  forgetAccount,
  forgetAllAccounts,
  kv,
  openAccountCopy,
  openAccountId,
  readJson,
  writeJson,
} from "./storage.ts";
import { clearOutbox, holdOutbox, releaseOutbox, useOutboxFor } from "./outbox.ts";
import { leavePractice, practiceMode, reloadPracticeMode } from "./practice-mode.ts";
import { reconnectLive } from "./live-socket.ts";

const KEY = "gigspree:me";
/** The accounts last seen on this device (names only), so the switcher shows them offline. */
const KNOWN = "accounts:known";
export type KnownAccount = Omit<DeviceAccount, "token">;

interface Session {
  /** Who the app shows (while rehearsing, the person played). */
  me: MeResponse | null;
  /** The signed-in account (never the person played), whose copy is open on this device. */
  account: string | null;
  loaded: boolean;
  error: string;
  refresh: () => Promise<void>;
  /** Signs out of every account on this device. */
  signOut: () => Promise<void>;
  /** The accounts this device is signed in to, from the server (online only). */
  listAccounts: () => Promise<DeviceAccount[]>;
  /** The same, as last seen (offline). */
  knownAccounts: () => KnownAccount[];
  /** Opens another account; says how many changes stayed waiting in the one left. */
  switchTo: (a: DeviceAccount) => Promise<number>;
  signOutOf: (a: DeviceAccount) => Promise<void>;
  /** Before signing in to another account: keeps this one. Throws with what's in the way. */
  prepareAdd: () => Promise<void>;
  cancelAdd: () => void;
}
const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(() => readJson<MeResponse>(KEY));
  const [loaded, setLoaded] = useState(me !== null);
  const [error, setError] = useState("");
  const [account, setAccount] = useState<string | null>(() => openAccountId());

  // The server said who is signed in: open that account's copy if it isn't the open one. While
  // rehearsing, `/api/me` is the person played; the account is the one practising.
  const opened = useCallback((next: MeResponse) => {
    const id = (next.practice && practiceMode()?.self) || next.user.id;
    if (id !== openAccountId()) {
      openAccountCopy(id);
      reloadPracticeMode();
      reconnectLive();
    }
    writeJson(KEY, next);
    setMe(next);
    setAccount(id);
  }, []);
  // The open account's session has ended: forget it and everything kept for it here.
  const closed = useCallback(() => {
    const id = openAccountId();
    clearOutbox();
    leavePractice();
    for (const k of kv.keys("gigspree:")) kv.remove(k);
    if (id) forgetAccount(id);
    openAccountCopy(null);
    setMe(null);
    setAccount(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      opened(await request<MeResponse>("GET", "/api/me"));
      setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) closed();
      else if (!me) setError(e instanceof Error ? e.message : String(e));
      // Otherwise (offline, server busy): keep showing the saved user and data.
    } finally {
      setLoaded(true);
    }
  }, [me, opened, closed]);

  const signOut = useCallback(async () => {
    try {
      await authSignOut();
    } catch {
      /* already out */
    }
    clearOutbox();
    leavePractice();
    forgetAllAccounts();
    for (const k of kv.keys("gigspree:")) kv.remove(k);
    openAccountCopy(null);
    kv.remove(KNOWN);
    setMe(null);
    setAccount(null);
  }, []);

  const knownAccounts = useCallback(() => readJson<KnownAccount[]>(KNOWN) ?? [], []);
  const listAccounts = useCallback(async () => {
    const list = await deviceAccounts();
    writeJson(
      KNOWN,
      list.map(({ token: _, ...a }) => a),
    );
    return list;
  }, []);

  const switchTo = useCallback(
    async (a: DeviceAccount) => {
      const waiting = await holdOutbox();
      // A rehearsal belongs to the account that started it.
      leavePractice();
      try {
        await openDeviceAccount(a.token);
      } catch (e) {
        releaseOutbox();
        throw e;
      }
      await refresh();
      return waiting;
    },
    [refresh],
  );

  const signOutOf = useCallback(
    async (a: DeviceAccount) => {
      const open = a.id === account;
      if (open) await holdOutbox();
      try {
        await signOutOfAccount(a.token);
      } catch (e) {
        if (open) releaseOutbox();
        throw e;
      }
      if (open) {
        clearOutbox();
        // The server opened another kept account, if there is one (otherwise: signed out).
        await refresh();
      }
      forgetAccount(a.id);
      writeJson(
        KNOWN,
        knownAccounts().filter((k) => k.id !== a.id),
      );
    },
    [account, refresh, knownAccounts],
  );

  const prepareAdd = useCallback(async () => {
    const waiting = await holdOutbox();
    if (waiting) {
      releaseOutbox();
      throw new Error(
        `${waiting === 1 ? "A change is" : `${waiting} changes are`} still waiting to be sent. Try again once you're connected.`,
      );
    }
    try {
      if (!(await keepThisAccount()))
        throw new Error("This device is signed in to five accounts already. Sign out of one first.");
    } catch (e) {
      releaseOutbox();
      throw e;
    }
    leavePractice();
  }, []);
  const cancelAdd = useCallback(() => releaseOutbox(), []);

  useEffect(() => {
    useOutboxFor(account);
  }, [account]);
  // Once at start (not on every refresh identity change).
  const first = useRef(true);
  useEffect(() => {
    if (!first.current) return;
    first.current = false;
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      me,
      account,
      loaded,
      error,
      refresh,
      signOut,
      listAccounts,
      knownAccounts,
      switchTo,
      signOutOf,
      prepareAdd,
      cancelAdd,
    }),
    [
      me,
      account,
      loaded,
      error,
      refresh,
      signOut,
      listAccounts,
      knownAccounts,
      switchTo,
      signOutOf,
      prepareAdd,
      cancelAdd,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

/** After a switch: Chats of the account now open, with nothing of the last one behind it. */
export function homeAfterSwitch() {
  if (router.canDismiss()) router.dismissAll();
  router.replace("/");
}
