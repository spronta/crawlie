// Account API keys — agent-native access. A key authenticates the CLI/MCP/CI
// as a Crawlie Cloud account for hosted crawls + reports. We store only the
// SHA-256 hash; the plaintext is returned once at creation.

import type { Env } from "./env";

export interface ApiKeyMeta {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

function genKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let b64 = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "");
  return `crw_${b64.slice(0, 32)}`;
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Create a key. Returns the plaintext ONCE (never stored). */
export async function createKey(env: Env, userId: string, name: string): Promise<{ key: string; meta: ApiKeyMeta }> {
  const key = genKey();
  const id = crypto.randomUUID().slice(0, 12);
  const prefix = key.slice(0, 12);
  const createdAt = Date.now();
  await env.DB.prepare(
    `INSERT INTO api_keys (id, user_id, name, prefix, key_hash, created_at) VALUES (?,?,?,?,?,?)`,
  )
    .bind(id, userId, name || "API key", prefix, await sha256(key), createdAt)
    .run();
  return { key, meta: { id, name: name || "API key", prefix, createdAt, lastUsedAt: null } };
}

export async function listKeys(env: Env, userId: string): Promise<ApiKeyMeta[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
  )
    .bind(userId)
    .all<Record<string, number | string | null>>();
  return (results ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    prefix: String(r.prefix),
    createdAt: Number(r.created_at),
    lastUsedAt: r.last_used_at == null ? null : Number(r.last_used_at),
  }));
}

export async function revokeKey(env: Env, userId: string, id: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM api_keys WHERE user_id = ? AND id = ?`).bind(userId, id).run();
}

/** Resolve a bearer key to its owning user id (and stamp last-used). */
export async function userIdForKey(env: Env, key: string): Promise<string | null> {
  if (!key.startsWith("crw_")) return null;
  const row = await env.DB.prepare(`SELECT id, user_id FROM api_keys WHERE key_hash = ?`)
    .bind(await sha256(key))
    .first<{ id: string; user_id: string }>();
  if (!row) return null;
  // Best-effort last-used stamp; don't block the request on it.
  await env.DB.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`)
    .bind(Date.now(), row.id)
    .run()
    .catch(() => {});
  return row.user_id;
}
