// Small app-wide settings in D1 (`app_settings`). Read on demand, written rarely.

export async function getSetting(d1: D1Database, key: string): Promise<string | null> {
  const row = await d1
    .prepare(`select value from app_settings where key = ?`)
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(d1: D1Database, key: string, value: string | null) {
  if (value === null) {
    await d1.prepare(`delete from app_settings where key = ?`).bind(key).run();
    return;
  }
  await d1
    .prepare(
      `insert into app_settings (key, value) values (?, ?)
       on conflict (key) do update set value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .bind(key, value)
    .run();
}
