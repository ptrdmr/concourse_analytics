import { getStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import { json, passcodeError } from "./lib/passcode.mts";

const STORE_NAME = "tip-worksheet";
const MAX_BODY_BYTES = 256 * 1024;
const MAX_RANGE_DAYS = 31;

function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addDays(iso: string, days: number): string {
  const [year, month, date] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, date));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function daysInRange(from: string, to: string): string[] {
  if (!isDay(from) || !isDay(to) || from > to) return [];
  const out: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
    if (out.length > MAX_RANGE_DAYS) return [];
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function validDecisions(body: unknown, date: string): Record<string, unknown> | null {
  const row = asRecord(body);
  if (!row || row.version !== 1 || row.date !== date) return null;
  if (!asRecord(row.cards) || !asRecord(row.issues)) return null;
  const cards = row.cards as Record<string, unknown>;
  if (Object.keys(cards).length > 80) return null;
  const issues = row.issues as Record<string, unknown>;
  if (Object.keys(issues).length > 200) return null;
  for (const issue of Object.values(issues)) {
    const entry = asRecord(issue);
    if (!entry) return null;
    if (entry.assignPool != null && entry.assignPool !== "bar" && entry.assignPool !== "cafe") return null;
    if (entry.assignEmployeeId != null && (typeof entry.assignEmployeeId !== "string" || entry.assignEmployeeId.length > 80)) return null;
    if (entry.note != null && (typeof entry.note !== "string" || entry.note.length > 500)) return null;
    if (entry.resolved != null && typeof entry.resolved !== "boolean") return null;
  }
  for (const card of Object.values(cards)) {
    const entry = asRecord(card);
    if (!entry) return null;
    for (const key of ["coordinators", "support", "bartenders", "removed", "added"] as const) {
      const list = entry[key];
      if (list == null) continue;
      if (!Array.isArray(list) || list.length > 80 || list.some((id) => typeof id !== "string" || id.length > 80)) {
        return null;
      }
    }
    const overrides = entry.overrides;
    if (overrides == null) continue;
    if (!Array.isArray(overrides) || overrides.length > 80) return null;
    for (const override of overrides) {
      const item = asRecord(override);
      if (!item || typeof item.employeeId !== "string" || typeof item.reason !== "string") return null;
      if (typeof item.cents !== "number" || !Number.isFinite(item.cents)) return null;
      if (item.cents > 10_000_000 || item.cents < -10_000_000) return null;
    }
  }
  return row;
}

async function readLatest(date: string): Promise<unknown> {
  const store = getStore(STORE_NAME);
  return store.get(`${date}/latest`, { type: "json" });
}

async function handleGet(url: URL): Promise<Response> {
  const date = url.searchParams.get("date") || "";
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  if (date) {
    if (!isDay(date)) return json(400, { error: "date must be YYYY-MM-DD" });
    const latest = await readLatest(date);
    return json(200, { date, decisions: latest ?? null });
  }
  const days = daysInRange(from, to);
  if (!days.length) return json(400, { error: "from and to (YYYY-MM-DD) are required, at most 31 days" });
  const out: Record<string, unknown> = {};
  for (const day of days) {
    const latest = await readLatest(day);
    if (latest) out[day] = latest;
  }
  return json(200, { days: out });
}

async function handlePost(req: Request): Promise<Response> {
  const length = Number(req.headers.get("content-length") || "0");
  if (length > MAX_BODY_BYTES) return json(413, { error: "Decision payload is too large" });
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return json(400, { error: "Expected JSON" });
  }
  const date = typeof (body as { date?: unknown })?.date === "string" ? (body as { date: string }).date : "";
  const decisions = validDecisions(body, date);
  if (!decisions) return json(400, { error: "Decisions were not in the expected shape" });
  const savedAt = new Date().toISOString();
  const stored = { ...decisions, savedAt };
  const store = getStore(STORE_NAME);
  const stamp = savedAt.replace(/[:.]/g, "-");
  await store.setJSON(`${date}/v/${stamp}`, stored);
  await store.setJSON(`${date}/latest`, stored);
  return json(200, { decisions: stored });
}

export default async function handler(req: Request, _context: Context): Promise<Response> {
  try {
    if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "method not allowed" });
    const denied = await passcodeError(req);
    if (denied) return denied;
    if (req.method === "GET") return await handleGet(new URL(req.url));
    return await handlePost(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : "save failed";
    return json(500, { error: message });
  }
}
