// Search from the one bar (decision 2026-10-16 "One bar"): what the home holds, matched on
// the device at once (lists, cards' titles and rows; works offline), and the person's own
// index on the server (every record and chat message they can see) a moment later when
// there's a connection.
import { useEffect, useState } from "react";
import { request } from "./api.ts";
import type { HomeCard } from "./home.ts";

export type SearchResult = RecordHit | MessageHit;

/** A piece of a chat I'm in. */
export interface MessageHit {
  kind: "message";
  group_id: string;
  chat: string;
  message_id: string;
  snippet: string;
  updated_at: string;
}

export interface RecordHit {
  kind: "record";
  space_id: string;
  space: string;
  collection_id: string;
  collection: string;
  record_id: string;
  title: string;
  snippet: string;
  updated_at: string;
}

export interface CardHit {
  card: HomeCard;
  /** The rows (or fields) that matched, a few. */
  rows: string[];
}

/** Cards whose title or rows contain the words, from what's on the device. */
export function cardHits(cards: HomeCard[], q: string, limit = 6): CardHit[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const seen = new Set<string>();
  const out: CardHit[] = [];
  for (const c of cards) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const lines = [
      ...c.records.map((r) => r.title),
      ...(c.shared?.fields ?? []).map((f) => `${f.name}: ${f.display}`),
      ...(c.waiting ? [c.waiting.text] : []),
    ];
    const rows = lines.filter((x) => x.toLowerCase().includes(needle));
    if (c.spec.title.toLowerCase().includes(needle) || rows.length)
      out.push({ card: c, rows: rows.slice(0, 3) });
    if (out.length >= limit) break;
  }
  return out;
}

/** Lists whose name contains the words. */
export function listHits(lists: { id: string; name: string }[], q: string, limit = 3) {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  return lists.filter((l) => l.name.toLowerCase().includes(needle)).slice(0, limit);
}

/** The server's index, a moment after typing stops; empty when offline or off. */
export function useRemoteHits(q: string, enabled: boolean): SearchResult[] {
  const [remote, setRemote] = useState<SearchResult[]>([]);
  useEffect(() => {
    const needle = q.trim();
    if (!enabled || needle.length < 2) {
      setRemote([]);
      return;
    }
    let gone = false;
    const timer = setTimeout(() => {
      request<SearchResult[]>("GET", `/api/search?q=${encodeURIComponent(needle)}&limit=8`)
        .then((hits) => !gone && setRemote(hits))
        .catch(() => !gone && setRemote([]));
    }, 250);
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [q, enabled]);
  return remote;
}
