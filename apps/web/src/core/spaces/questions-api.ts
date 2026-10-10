// Questions sent to people (chat-first step 4): the owner asks, the people asked answer from
// Shared with you, and answers arrive on the card live.
import type { QuestionView, SharedQuestionView } from "@assistant/shared";
import { request } from "../api.ts";

const enc = encodeURIComponent;
export const questionKey = (id: string) => `spaces:question:${id}`;

// online-only: a question reaches other people, and an answer goes to the asker's space.
export const questionsApi = {
  /** `key` stays the same across retries of one ask, so it's sent (and shown in the chat) once. */
  ask: (
    body: { id: string; text: string; choices?: string[]; people: string[]; chat_id?: string },
    key: string,
  ) => request<QuestionView>("POST", "/api/questions", body, { key }),
  get: (id: string) => request<QuestionView>("GET", `/api/questions/${enc(id)}`),
  close: (id: string, closed: boolean) =>
    request<QuestionView>("POST", `/api/questions/${enc(id)}/close`, { closed }),
  answer: (shareId: string, answer: string) =>
    request<SharedQuestionView>("POST", `/api/cards/${enc(shareId)}/answer`, { answer }),
};
