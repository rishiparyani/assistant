// The signed-in user, as the web app and assistants see it.
export interface MeResponse {
  user: { id: string; name: string; email: string; image: string | null };
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
