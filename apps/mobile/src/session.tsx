// The signed-in user. The last known user is kept on the device so the app opens instantly;
// the server check runs in the background and signs out if the session has ended.
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
import type { MeResponse } from "@assistant/shared";
import { ApiError, request } from "./api.ts";
import { signOut as authSignOut } from "./auth.ts";
import { kv, readJson, writeJson } from "./storage.ts";
import { clearOutbox, useOutboxFor } from "./outbox.ts";

const KEY = "gigspree:me";

interface Session {
  me: MeResponse | null;
  loaded: boolean;
  error: string;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}
const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(() => readJson<MeResponse>(KEY));
  const [loaded, setLoaded] = useState(me !== null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await request<MeResponse>("GET", "/api/me");
      setMe(next);
      writeJson(KEY, next);
      setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // The session has ended: forget the person and everything kept for them on this device.
        clearOutbox();
        for (const k of kv.keys("gigspree:")) kv.remove(k);
        setMe(null);
      } else if (!me) setError(e instanceof Error ? e.message : String(e));
      // Otherwise (offline, server busy): keep showing the saved user and data.
    } finally {
      setLoaded(true);
    }
  }, [me]);

  const signOut = useCallback(async () => {
    try {
      await authSignOut();
    } catch {
      /* already out */
    }
    clearOutbox();
    for (const k of kv.keys("gigspree:")) kv.remove(k);
    setMe(null);
  }, []);

  useEffect(() => {
    useOutboxFor(me?.user.id ?? null);
  }, [me?.user.id]);
  // Once at start (not on every refresh identity change).
  const first = useRef(true);
  useEffect(() => {
    if (!first.current) return;
    first.current = false;
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ me, loaded, error, refresh, signOut }),
    [me, loaded, error, refresh, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
