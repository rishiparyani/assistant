// Google Drive for backups (owner's choice, decision 2026-09-28). Scope `drive.file`:
// the app sees only files it created, never the rest of the owner's Drive. The Google
// client is the one used for sign-in (GOOGLE_CLIENT_ID/SECRET); the refresh token is
// kept encrypted in app_settings.

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** The few Drive calls backups need; a fake stands in for tests. */
export interface DriveClient {
  ensureFolder(name: string): Promise<string>;
  upload(folderId: string, name: string, data: Uint8Array, mime: string): Promise<{ id: string }>;
  list(folderId: string): Promise<{ id: string; name: string; createdTime: string }[]>;
  remove(fileId: string): Promise<void>;
  download(fileId: string): Promise<Uint8Array>;
}

type Fetch = typeof fetch;

export function authUrl(clientId: string, redirectUri: string, state: string): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  }).toString();
  return u.toString();
}

async function tokenRequest(body: Record<string, string>, f: Fetch) {
  const res = await f("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
  };
  if (!res.ok || !json.access_token)
    throw new Error(`Google token request failed (${res.status} ${json.error ?? ""})`);
  return json;
}

export async function exchangeCode(
  cfg: { clientId: string; clientSecret: string; redirectUri: string },
  code: string,
  f: Fetch = fetch,
): Promise<string> {
  const t = await tokenRequest(
    {
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    },
    f,
  );
  if (!t.refresh_token)
    throw new Error("Google didn't return a refresh token; remove the app's access and connect again");
  return t.refresh_token;
}

/** A Drive client that signs in with the refresh token for each run. */
export async function googleDrive(
  cfg: { clientId: string; clientSecret: string; refreshToken: string },
  f: Fetch = fetch,
): Promise<DriveClient> {
  const { access_token } = await tokenRequest(
    {
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: "refresh_token",
    },
    f,
  );
  const auth = { authorization: `Bearer ${access_token}` };
  const api = "https://www.googleapis.com/drive/v3/files";
  const check = async (res: Response, what: string) => {
    if (!res.ok) throw new Error(`Drive ${what} failed (${res.status})`);
    return res;
  };
  return {
    async ensureFolder(name) {
      const q = `mimeType = 'application/vnd.google-apps.folder' and name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
      const found = (await (
        await check(
          await f(`${api}?${new URLSearchParams({ q, fields: "files(id)" })}`, { headers: auth }),
          "search",
        )
      ).json()) as { files: { id: string }[] };
      if (found.files[0]) return found.files[0].id;
      const made = (await (
        await check(
          await f(api, {
            method: "POST",
            headers: { ...auth, "content-type": "application/json" },
            body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }),
          }),
          "create folder",
        )
      ).json()) as { id: string };
      return made.id;
    },
    async upload(folderId, name, data, mime) {
      const boundary = `assistant-${crypto.randomUUID()}`;
      const head = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folderId] })}\r\n--${boundary}\r\ncontent-type: ${mime}\r\n\r\n`;
      const tail = `\r\n--${boundary}--`;
      const body = new Uint8Array([
        ...new TextEncoder().encode(head),
        ...data,
        ...new TextEncoder().encode(tail),
      ]);
      const res = await check(
        await f("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
          method: "POST",
          headers: { ...auth, "content-type": `multipart/related; boundary=${boundary}` },
          body,
        }),
        "upload",
      );
      return (await res.json()) as { id: string };
    },
    async list(folderId) {
      const q = `'${folderId}' in parents and trashed = false`;
      const res = await check(
        await f(
          `${api}?${new URLSearchParams({ q, orderBy: "createdTime desc", pageSize: "200", fields: "files(id,name,createdTime)" })}`,
          {
            headers: auth,
          },
        ),
        "list",
      );
      return ((await res.json()) as { files: { id: string; name: string; createdTime: string }[] }).files;
    },
    async remove(fileId) {
      await check(await f(`${api}/${fileId}`, { method: "DELETE", headers: auth }), "delete");
    },
    async download(fileId) {
      const res = await check(await f(`${api}/${fileId}?alt=media`, { headers: auth }), "download");
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
