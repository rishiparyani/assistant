// The signed-in user, as the web app and assistants see it.
export interface MeResponse {
  user: { id: string; name: string; email: string; image: string | null };
  /** Whether the in-app assistant is on for this person (collaborators: off unless switched on). */
  assistant: boolean;
  /**
   * Set while the app is used as one of a practice copy's people (docs/design/from-scratch.md
   * §2 point 9): the copy, the space it copies, and who is played. `user` is then that person.
   */
  practice?: { space: string; of: string; as: string };
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
