import { readFile, writeFile, rename, mkdir, appendFile, unlink } from "fs/promises";
import { join } from "path";
import type { Plugin } from "@opencode-ai/plugin";

interface ModelUsage {
  model: string;
  provider: string;
  agent: string;
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

interface SessionRecord {
  sessionID: string;
  slug: string;
  title: string;
  models: ModelUsage[];
  totalCost: number;
  directory: string;
  createdAt: number;
}

type SessionInfo = {
  id: string;
  slug?: string;
  title?: string;
  model?: { id: string; providerID: string };
  agent?: string;
  cost?: number;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
  time?: { created: number };
  directory?: string;
};

const SESSIONS_DIR = ".opencode-sessions";
const OLD_FILE = ".opencode-sessions.json";

const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/;

const home = (): string => {
  const h = process.env.HOME;
  if (!h) throw new Error("HOME is not set");
  return h;
};

const assertSafeId = (id: unknown): void => {
  if (typeof id !== "string" || !SAFE_ID.test(id)) {
    throw new Error(`Invalid sessionID: ${JSON.stringify(id)}`);
  }
};

const sessionsDir = () => join(home(), SESSIONS_DIR);
const sessionPath = (id: string) => {
  assertSafeId(id);
  return join(sessionsDir(), `${id}.json`);
};
const oldFilePath = () => join(home(), OLD_FILE);
const debugPath = () => join(home(), ".opencode-sessions-debug.jsonl");

const isValidModelUsage = (x: unknown): x is ModelUsage => {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const m = x as Record<string, unknown>;
  if (
    typeof m.model !== "string" ||
    typeof m.provider !== "string" ||
    typeof m.agent !== "string" ||
    typeof m.cost !== "number"
  ) {
    return false;
  }
  const t = m.tokens;
  if (typeof t !== "object" || t === null || Array.isArray(t)) return false;
  const tok = t as Record<string, unknown>;
  return (
    typeof tok.input === "number" &&
    typeof tok.output === "number" &&
    typeof tok.reasoning === "number" &&
    typeof tok.cacheRead === "number" &&
    typeof tok.cacheWrite === "number"
  );
};

const isValidSessionRecord = (x: unknown): x is SessionRecord => {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.sessionID === "string" &&
    typeof r.slug === "string" &&
    typeof r.title === "string" &&
    Array.isArray(r.models) &&
    r.models.every(isValidModelUsage) &&
    typeof r.totalCost === "number" &&
    typeof r.directory === "string" &&
    typeof r.createdAt === "number"
  );
};

const quarantineCorrupt = async (path: string): Promise<void> => {
  try {
    await rename(path, `${path}.corrupt`);
  } catch {
    // best-effort
  }
};

export async function loadSession(id: string): Promise<SessionRecord | null> {
  const path = sessionPath(id);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isValidSessionRecord(parsed) || parsed.sessionID !== id) {
      await quarantineCorrupt(path);
      return null;
    }
    return parsed;
  } catch (err) {
    if (err instanceof SyntaxError) {
      await quarantineCorrupt(path);
      return null;
    }
    throw err;
  }
}

export async function saveSession(record: SessionRecord): Promise<void> {
  await mkdir(sessionsDir(), { recursive: true });
  const finalPath = sessionPath(record.sessionID);
  const tmpPath = `${finalPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(record, null, 2), "utf8");
  try {
    await rename(tmpPath, finalPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      await unlink(tmpPath).catch(() => {});
      throw err;
    }
  }
}

export function selectTokens(
  info: SessionInfo,
  prev?: ModelUsage["tokens"],
): ModelUsage["tokens"] {
  if (!prev) {
    return {
      input: info.tokens?.input ?? 0,
      output: info.tokens?.output ?? 0,
      reasoning: info.tokens?.reasoning ?? 0,
      cacheRead: info.tokens?.cache?.read ?? 0,
      cacheWrite: info.tokens?.cache?.write ?? 0,
    };
  }
  return {
    input: info.tokens?.input ?? prev.input,
    output: info.tokens?.output ?? prev.output,
    reasoning: info.tokens?.reasoning ?? prev.reasoning,
    cacheRead: info.tokens?.cache?.read ?? prev.cacheRead,
    cacheWrite: info.tokens?.cache?.write ?? prev.cacheWrite,
  };
}

export function applyUpdate(
  record: SessionRecord | null,
  info: SessionInfo,
): SessionRecord {
  assertSafeId(info.id);
  const modelID = info.model?.id ?? "unknown";
  const providerID = info.model?.providerID ?? "unknown";
  const agent = info.agent ?? "unknown";

  if (!record) {
    return {
      sessionID: info.id,
      slug: info.slug ?? "",
      title: info.title ?? "Untitled",
      models: [
        {
          model: modelID,
          provider: providerID,
          agent,
          cost: info.cost ?? 0,
          tokens: selectTokens(info),
        },
      ],
      totalCost: info.cost ?? 0,
      directory: info.directory ?? "",
      createdAt: info.time?.created ?? Date.now(),
    };
  }

  const next: SessionRecord = structuredClone(record);
  const idx = next.models.findIndex(
    (m) => m.model === modelID && m.provider === providerID,
  );

  const usage: ModelUsage = {
    model: modelID,
    provider: providerID,
    agent,
    cost:
      info.cost ?? (idx === -1 ? 0 : next.models[idx].cost),
    tokens: selectTokens(
      info,
      idx === -1 ? undefined : next.models[idx].tokens,
    ),
  };

  if (idx === -1) {
    next.models.push(usage);
  } else {
    next.models[idx] = usage;
  }

  next.totalCost = next.models.reduce((sum, m) => sum + m.cost, 0);

  if (info.title && info.title !== "Untitled") {
    next.title = info.title;
  }
  if (info.slug) {
    next.slug = info.slug;
  }

  return next;
}

export async function migrateIfNeeded(): Promise<void> {
  const oldPath = oldFilePath();
  let text: string;
  try {
    text = await readFile(oldPath, "utf8");
  } catch {
    return;
  }

  type OldRecord = {
    sessionID: string;
    slug: string;
    title?: string;
    model: string;
    provider: string;
    agent: string;
    cost: number;
    tokens: ModelUsage["tokens"];
    directory?: string;
    createdAt: number;
  };

  let old: OldRecord[];
  try {
    old = JSON.parse(text);
  } catch {
    try {
      await rename(oldPath, `${oldPath}.migrated.invalid`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
    }
    return;
  }

  if (!Array.isArray(old)) {
    try {
      await rename(oldPath, `${oldPath}.migrated.invalid`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
    }
    return;
  }

  await mkdir(sessionsDir(), { recursive: true });
  for (const o of old) {
    if (
      !o ||
      typeof o !== "object" ||
      typeof o.sessionID !== "string" ||
      !SAFE_ID.test(o.sessionID) ||
      typeof o.slug !== "string" ||
      typeof o.createdAt !== "number" ||
      typeof o.model !== "string" ||
      typeof o.provider !== "string" ||
      typeof o.agent !== "string" ||
      typeof o.cost !== "number" ||
      (o.tokens !== undefined &&
        (typeof o.tokens !== "object" ||
          o.tokens === null ||
          Array.isArray(o.tokens)))
    ) {
      continue;
    }
    const tokens = o.tokens ?? {
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
    };
    const migrated: SessionRecord = {
      sessionID: o.sessionID,
      slug: o.slug,
      title: o.title ?? "Untitled",
      models: [
        {
          model: o.model ?? "unknown",
          provider: o.provider ?? "unknown",
          agent: o.agent ?? "unknown",
          cost: o.cost ?? 0,
          tokens,
        },
      ],
      totalCost: o.cost ?? 0,
      directory: o.directory ?? "",
      createdAt: o.createdAt ?? Date.now(),
    };
    await saveSession(migrated);
  }
  try {
    await rename(oldPath, `${oldPath}.migrated`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }
}

async function debugLog(eventType: string, info: SessionInfo): Promise<void> {
  const line =
    JSON.stringify({
      timestamp: Date.now(),
      eventType,
      sessionID: info.id,
      info,
    }) + "\n";
  try {
    await appendFile(debugPath(), line, "utf8");
  } catch {
    // best-effort
  }
}

export interface DateBucket {
  date: string;
  cost: number;
  sessions: number;
  sessionIDs: string[];
}

export function bucketByDate(records: SessionRecord[]): DateBucket[] {
  const buckets = new Map<string, DateBucket>();
  for (const r of records) {
    if (r == null) continue;
    if (!Number.isFinite(r.createdAt)) continue;
    if (!Number.isFinite(r.totalCost)) continue;
    const date = localDateKey(new Date(r.createdAt));
    const existing = buckets.get(date);
    if (existing) {
      existing.cost += r.totalCost;
      existing.sessions += 1;
      existing.sessionIDs.push(r.sessionID);
    } else {
      buckets.set(date, {
        date,
        cost: r.totalCost,
        sessions: 1,
        sessionIDs: [r.sessionID],
      });
    }
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const localDateKey = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const inflight = new Map<string, Promise<void>>();

export const scheduleUpdate = (eventType: string, info: SessionInfo): Promise<void> => {
  const prev = inflight.get(info.id) ?? Promise.resolve();
  const next = prev.then(() => doUpdate(eventType, info), () => doUpdate(eventType, info));
  inflight.set(info.id, next);
  next.then(
    () => {
      if (inflight.get(info.id) === next) {
        inflight.delete(info.id);
      }
    },
    () => {
      if (inflight.get(info.id) === next) {
        inflight.delete(info.id);
      }
    },
  );
  return next;
};

const doUpdate = async (eventType: string, info: SessionInfo): Promise<void> => {
  const existing = await loadSession(info.id);
  const updated = applyUpdate(existing, info);
  await saveSession(updated);
  if (process.env.OC_SESSION_DEBUG === "1") {
    await debugLog(eventType, info);
  }
};

export default (async () => {
  await migrateIfNeeded();
  return {
    event: async ({ event }) => {
      if (event.type !== "session.created" && event.type !== "session.updated") {
        return;
      }
      const info = event.properties.info as unknown as SessionInfo;
      try {
        await scheduleUpdate(event.type, info);
      } catch {
        // best-effort cost tracking; never crash opencode
      }
    },
    dispose: async () => {
      await Promise.allSettled(inflight.values());
    },
  };
}) satisfies Plugin;
