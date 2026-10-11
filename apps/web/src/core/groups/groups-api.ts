// Group chats (chat-first step 7). No logic here.
import { ulid, type GroupSummary, type GroupView } from "@assistant/shared";
import { request } from "../api.ts";

const enc = encodeURIComponent;
export const GROUPS_KEY = "groups:list";
export const groupKey = (id: string) => `groups:view:${id}`;

export const groupsApi = {
  list: () => request<GroupSummary[]>("GET", "/api/groups"),
  get: (id: string) => request<GroupView>("GET", `/api/groups/${enc(id)}`),
  // online-only: a group lives on the server, which tells its members.
  create: (name: string, people: string[]) =>
    request<GroupView>("POST", "/api/groups", { id: ulid(), name, people }),
  // online-only: messages are delivered by the server (and @assistant answers there).
  post: (id: string, text: string) => request<GroupView>("POST", `/api/groups/${enc(id)}/messages`, { text }),
  // online-only: the server checks who may be added.
  add: (id: string, people: string[]) =>
    request<GroupView>("POST", `/api/groups/${enc(id)}/people`, { people }),
  // online-only: leaving is done on the server.
  leave: (id: string) => request<{ left: string }>("POST", `/api/groups/${enc(id)}/leave`, {}),
};
