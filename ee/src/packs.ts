// Rule packs — editable .crawlie content rules a team runs on every crawl
// (slop, brand voice, banned terms, required disclaimers). Stored per team;
// enabled packs are handed to the container, which evaluates them per page.

import type { Env } from "./env";

export interface RulePack {
  id: string;
  name: string;
  source: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

const rid = () => crypto.randomUUID().slice(0, 12);

function row(r: Record<string, unknown>): RulePack {
  return {
    id: String(r.id),
    name: String(r.name),
    source: String(r.source),
    enabled: Number(r.enabled) === 1,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export async function listPacks(env: Env, teamId: string): Promise<RulePack[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM rule_packs WHERE team_id = ? ORDER BY created_at ASC`)
    .bind(teamId)
    .all<Record<string, unknown>>();
  return (results ?? []).map(row);
}

export async function getPack(env: Env, teamId: string, id: string): Promise<RulePack | null> {
  const r = await env.DB.prepare(`SELECT * FROM rule_packs WHERE team_id = ? AND id = ?`).bind(teamId, id).first<Record<string, unknown>>();
  return r ? row(r) : null;
}

export async function createPack(env: Env, teamId: string, input: { name: string; source: string; enabled?: boolean }): Promise<RulePack> {
  const id = rid();
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO rule_packs (id, team_id, name, source, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`)
    .bind(id, teamId, input.name.trim() || "New pack", input.source, input.enabled === false ? 0 : 1, now, now)
    .run();
  return (await getPack(env, teamId, id))!;
}

export async function updatePack(env: Env, teamId: string, id: string, patch: { name?: string; source?: string; enabled?: boolean }): Promise<RulePack | null> {
  const p = await getPack(env, teamId, id);
  if (!p) return null;
  await env.DB.prepare(`UPDATE rule_packs SET name=?, source=?, enabled=?, updated_at=? WHERE team_id=? AND id=?`)
    .bind(patch.name?.trim() || p.name, patch.source ?? p.source, patch.enabled == null ? (p.enabled ? 1 : 0) : patch.enabled ? 1 : 0, Date.now(), teamId, id)
    .run();
  return getPack(env, teamId, id);
}

export async function deletePack(env: Env, teamId: string, id: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM rule_packs WHERE team_id = ? AND id = ?`).bind(teamId, id).run();
}

/** Enabled packs as {name, source} for the container to evaluate. */
export async function enabledPackSources(env: Env, teamId: string): Promise<Array<{ name: string; source: string }>> {
  const { results } = await env.DB.prepare(`SELECT name, source FROM rule_packs WHERE team_id = ? AND enabled = 1`)
    .bind(teamId)
    .all<{ name: string; source: string }>();
  return (results ?? []).map((r) => ({ name: String(r.name), source: String(r.source) }));
}
