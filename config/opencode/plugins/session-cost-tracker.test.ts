import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  applyUpdate,
  selectTokens,
  loadSession,
  saveSession,
  migrateIfNeeded,
  scheduleUpdate,
  bucketByDate,
} from "./session-cost-tracker.ts";
import plugin from "./session-cost-tracker.ts";

const ORIGINAL_HOME = process.env.HOME;

let tempHome: string;

test.beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "oct-test-"));
  process.env.HOME = tempHome;
});

test.afterEach(async () => {
  await rm(tempHome, { recursive: true, force: true });
  process.env.HOME = ORIGINAL_HOME;
});

test("selectTokens: missing fields default to 0 without prev", () => {
  const info = { id: "ses_a", slug: "s" };
  const tokens = selectTokens(info);
  assert.deepEqual(tokens, {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
});

test("selectTokens: keeps prev values when info has no token fields", () => {
  const info = { id: "ses_a", slug: "s" };
  const prev = { input: 100, output: 50, reasoning: 10, cacheRead: 5, cacheWrite: 2 };
  const tokens = selectTokens(info, prev);
  assert.deepEqual(tokens, prev);
});

test("selectTokens: merges partial info with prev", () => {
  const info = { id: "ses_a", slug: "s", tokens: { input: 200 } };
  const prev = { input: 100, output: 50, reasoning: 10, cacheRead: 5, cacheWrite: 2 };
  const tokens = selectTokens(info, prev);
  assert.deepEqual(tokens, {
    input: 200,
    output: 50,
    reasoning: 10,
    cacheRead: 5,
    cacheWrite: 2,
  });
});

test("applyUpdate: creates new record when none exists", () => {
  const info = {
    id: "ses_new123",
    slug: "test-slug",
    title: "Hello",
    model: { id: "claude-opus", providerID: "anthropic" },
    agent: "build",
    cost: 0.5,
    tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1000 },
    directory: "/tmp",
  };
  const record = applyUpdate(null, info);
  assert.equal(record.sessionID, "ses_new123");
  assert.equal(record.slug, "test-slug");
  assert.equal(record.title, "Hello");
  assert.equal(record.totalCost, 0.5);
  assert.equal(record.directory, "/tmp");
  assert.equal(record.createdAt, 1000);
  assert.equal(record.models.length, 1);
  assert.deepEqual(record.models[0], {
    model: "claude-opus",
    provider: "anthropic",
    agent: "build",
    cost: 0.5,
    tokens: {
      input: 100,
      output: 200,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
  });
});

test("applyUpdate: updates existing model entry in place", () => {
  const base = applyUpdate(null, {
    id: "ses_a",
    slug: "s",
    title: "real-title",
    model: { id: "claude-opus", providerID: "anthropic" },
    cost: 0.1,
    tokens: { input: 10 },
  });
  const updated = applyUpdate(base, {
    id: "ses_a",
    slug: "s",
    model: { id: "claude-opus", providerID: "anthropic" },
    cost: 0.2,
    tokens: { input: 50, output: 30 },
  });
  assert.equal(updated.models.length, 1);
  assert.equal(updated.models[0].cost, 0.2);
  assert.equal(updated.models[0].tokens.input, 50);
  assert.equal(updated.models[0].tokens.output, 30);
  assert.equal(updated.totalCost, 0.2);
  assert.equal(updated.title, "real-title");
});

test("applyUpdate: model switch appends new ModelUsage entry", () => {
  const base = applyUpdate(null, {
    id: "ses_a",
    slug: "s",
    model: { id: "claude-opus", providerID: "anthropic" },
    cost: 0.1,
  });
  const updated = applyUpdate(base, {
    id: "ses_a",
    slug: "s",
    model: { id: "gpt-5", providerID: "openai" },
    cost: 0.4,
  });
  assert.equal(updated.models.length, 2);
  assert.equal(updated.totalCost, 0.5);
});

test("applyUpdate: totalCost sums across models", () => {
  let r = applyUpdate(null, {
    id: "ses_a",
    slug: "s",
    model: { id: "m1", providerID: "p1" },
    cost: 0.1,
  });
  r = applyUpdate(r, {
    id: "ses_a",
    slug: "s",
    model: { id: "m2", providerID: "p2" },
    cost: 0.25,
  });
  r = applyUpdate(r, {
    id: "ses_a",
    slug: "s",
    model: { id: "m3", providerID: "p3" },
    cost: 0.05,
  });
  assert.equal(r.models.length, 3);
  assert.ok(
    Math.abs(r.totalCost - 0.4) < 1e-9,
    `totalCost=${r.totalCost}, expected ~0.4`,
  );
});

test("applyUpdate: title 'Untitled' does not overwrite real title", () => {
  const base = applyUpdate(null, {
    id: "ses_a",
    slug: "s",
    title: "real-title",
    model: { id: "m", providerID: "p" },
  });
  assert.equal(base.title, "real-title");
  const updated = applyUpdate(base, {
    id: "ses_a",
    slug: "s",
    title: "Untitled",
    model: { id: "m", providerID: "p" },
  });
  assert.equal(updated.title, "real-title");
});

test("applyUpdate: rejects unsafe sessionID at entry point", () => {
  assert.throws(
    () => applyUpdate(null, { id: "../../etc/passwd", slug: "s" }),
    /Invalid sessionID/,
  );
  assert.throws(
    () => applyUpdate(null, { id: "ses_a/bad", slug: "s" }),
    /Invalid sessionID/,
  );
  assert.throws(
    () => applyUpdate(null, { id: "", slug: "s" }),
    /Invalid sessionID/,
  );
});

test("saveSession + loadSession: atomic roundtrip", async () => {
  const record = applyUpdate(null, {
    id: "ses_round",
    slug: "s",
    title: "t",
    model: { id: "m", providerID: "p" },
    cost: 0.42,
  });
  await saveSession(record);
  const loaded = await loadSession("ses_round");
  assert.deepEqual(loaded, record);
  await assert.rejects(stat(join(tempHome, ".opencode-sessions", "ses_round.json.tmp")));
});

test("saveSession: rejects unsafe sessionID", async () => {
  await assert.rejects(
    saveSession({
      sessionID: "../escape",
      slug: "s",
      title: "t",
      models: [],
      totalCost: 0,
      directory: "",
      createdAt: 0,
    }),
    /Invalid sessionID/,
  );
});

test("loadSession: returns null on ENOENT", async () => {
  const result = await loadSession("ses_does_not_exist");
  assert.equal(result, null);
});

test("loadSession: quarantines corrupt JSON and returns null", async () => {
  const dir = join(tempHome, ".opencode-sessions");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "ses_corrupt.json");
  await writeFile(path, "{not valid json");
  const result = await loadSession("ses_corrupt");
  assert.equal(result, null);
  await stat(`${path}.corrupt`);
  await assert.rejects(stat(path));
});

test("loadSession: quarantines wrong-shape JSON and returns null", async () => {
  const dir = join(tempHome, ".opencode-sessions");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "ses_wrongshape.json");
  await writeFile(path, JSON.stringify({ just: "an object" }));
  const result = await loadSession("ses_wrongshape");
  assert.equal(result, null);
  await stat(`${path}.corrupt`);
  await assert.rejects(stat(path));
});

test("loadSession: quarantines JSON array (wrong root shape) and returns null", async () => {
  const dir = join(tempHome, ".opencode-sessions");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "ses_array.json");
  await writeFile(path, JSON.stringify([1, 2, 3]));
  const result = await loadSession("ses_array");
  assert.equal(result, null);
  await stat(`${path}.corrupt`);
});

test("loadSession: quarantines when models has null element", async () => {
  const dir = join(tempHome, ".opencode-sessions");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "ses_nullmodel.json");
  await writeFile(path, JSON.stringify({
    sessionID: "ses_nullmodel",
    slug: "s",
    title: "t",
    models: [null],
    totalCost: 0,
    directory: "",
    createdAt: 0,
  }));
  const result = await loadSession("ses_nullmodel");
  assert.equal(result, null);
  await stat(`${path}.corrupt`);
  await assert.rejects(stat(path));
});

test("loadSession: quarantines when models has wrong-shape element", async () => {
  const dir = join(tempHome, ".opencode-sessions");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "ses_badmodel.json");
  await writeFile(path, JSON.stringify({
    sessionID: "ses_badmodel",
    slug: "s",
    title: "t",
    models: [{ model: "m", provider: "p", agent: "a", cost: "wrong" }],
    totalCost: 0,
    directory: "",
    createdAt: 0,
  }));
  const result = await loadSession("ses_badmodel");
  assert.equal(result, null);
  await stat(`${path}.corrupt`);
});

test("loadSession: quarantines when parsed sessionID does not match requested id", async () => {
  const dir = join(tempHome, ".opencode-sessions");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "ses_x.json");
  await writeFile(path, JSON.stringify({
    sessionID: "ses_y",
    slug: "s",
    title: "t",
    models: [],
    totalCost: 0,
    directory: "",
    createdAt: 0,
  }));
  const result = await loadSession("ses_x");
  assert.equal(result, null);
  await stat(`${path}.corrupt`);
  await assert.rejects(stat(path));
});

test("applyUpdate: self-heals via fresh record when previous file was quarantined", async () => {
  const dir = join(tempHome, ".opencode-sessions");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "ses_heal2.json");
  await writeFile(path, JSON.stringify({ broken: true }));
  await assert.equal(await loadSession("ses_heal2"), null);
  await scheduleUpdate("session.created", {
    id: "ses_heal2",
    slug: "s",
    model: { id: "m", providerID: "p" },
    cost: 0.05,
  });
  const healed = await loadSession("ses_heal2");
  assert.ok(healed);
  assert.equal(healed.totalCost, 0.05);
});

test("loadSession: after quarantine, fresh saveSession succeeds", async () => {
  const dir = join(tempHome, ".opencode-sessions");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "ses_heal.json");
  await writeFile(path, "{broken");
  assert.equal(await loadSession("ses_heal"), null);
  await saveSession({
    sessionID: "ses_heal",
    slug: "s",
    title: "t",
    models: [
      {
        model: "m",
        provider: "p",
        agent: "a",
        cost: 0.1,
        tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
    totalCost: 0.1,
    directory: "",
    createdAt: 0,
  });
  const healed = await loadSession("ses_heal");
  assert.ok(healed);
  assert.equal(healed.totalCost, 0.1);
});

test("migrateIfNeeded: missing old file is a no-op", async () => {
  await migrateIfNeeded();
  const dirExists = await stat(join(tempHome, ".opencode-sessions"))
    .then(() => true)
    .catch(() => false);
  assert.equal(dirExists, false);
});

test("migrateIfNeeded: valid array migrates per-session and renames old", async () => {
  const oldData = [
    {
      sessionID: "ses_old1",
      slug: "old-slug",
      title: "old-title",
      model: "m1",
      provider: "p1",
      agent: "a1",
      cost: 0.3,
      tokens: { input: 1, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      directory: "/old",
      createdAt: 12345,
    },
  ];
  await writeFile(join(tempHome, ".opencode-sessions.json"), JSON.stringify(oldData));
  await migrateIfNeeded();
  const loaded = await loadSession("ses_old1");
  assert.ok(loaded);
  assert.equal(loaded.sessionID, "ses_old1");
  assert.equal(loaded.slug, "old-slug");
  assert.equal(loaded.totalCost, 0.3);
  assert.equal(loaded.models.length, 1);
  assert.equal(loaded.models[0].model, "m1");
  await stat(join(tempHome, ".opencode-sessions.json.migrated"));
  await assert.rejects(stat(join(tempHome, ".opencode-sessions.json")));
});

test("migrateIfNeeded: invalid JSON renames to .migrated.invalid", async () => {
  await writeFile(join(tempHome, ".opencode-sessions.json"), "{not json");
  await migrateIfNeeded();
  await stat(join(tempHome, ".opencode-sessions.json.migrated.invalid"));
  await assert.rejects(stat(join(tempHome, ".opencode-sessions.json")));
});

test("migrateIfNeeded: non-array renames to .migrated.invalid", async () => {
  await writeFile(join(tempHome, ".opencode-sessions.json"), JSON.stringify({ not: "array" }));
  await migrateIfNeeded();
  await stat(join(tempHome, ".opencode-sessions.json.migrated.invalid"));
});

test("migrateIfNeeded: skips malformed entries", async () => {
  const oldData = [
    null,
    "string",
    42,
    {
      sessionID: "ses_no_slug",
      createdAt: 1,
    },
    {
      sessionID: "../bad",
      slug: "s",
      createdAt: 1,
    },
    {
      slug: "s",
      createdAt: 1,
    },
    {
      sessionID: "ses_good",
      slug: "good-slug",
      title: "t",
      model: "m",
      provider: "p",
      agent: "a",
      cost: 0.1,
      tokens: undefined,
      createdAt: 99,
    },
  ];
  await writeFile(join(tempHome, ".opencode-sessions.json"), JSON.stringify(oldData));
  await migrateIfNeeded();
  const loaded = await loadSession("ses_good");
  assert.ok(loaded);
  assert.equal(loaded.slug, "good-slug");
  assert.equal(loaded.totalCost, 0.1);
  const loadedBad = await loadSession("ses_no_slug");
  assert.equal(loadedBad, null);
  await stat(join(tempHome, ".opencode-sessions.json.migrated"));
});

test("migrateIfNeeded: concurrent calls do not throw on rename", async () => {
  const oldData = [
    {
      sessionID: "ses_concurrent",
      slug: "concurrent-slug",
      createdAt: 42,
      model: "m",
      provider: "p",
      agent: "a",
      cost: 0.7,
      tokens: { input: 1, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    },
  ];
  await writeFile(join(tempHome, ".opencode-sessions.json"), JSON.stringify(oldData));
  await Promise.all([migrateIfNeeded(), migrateIfNeeded(), migrateIfNeeded()]);
  const loaded = await loadSession("ses_concurrent");
  assert.ok(loaded);
  assert.equal(loaded.sessionID, "ses_concurrent");
  assert.equal(loaded.slug, "concurrent-slug");
  assert.equal(loaded.totalCost, 0.7);
  assert.equal(loaded.createdAt, 42);
});

test("applyUpdate: does not mutate input record", () => {
  const base = applyUpdate(null, {
    id: "ses_base",
    slug: "base-slug",
    title: "base-title",
    model: { id: "m1", providerID: "p1" },
    cost: 0.1,
    tokens: { input: 10 },
    time: { created: 0 },
  });
  const before = JSON.parse(JSON.stringify(base));
  applyUpdate(base, {
    id: "ses_base",
    slug: "base-slug",
    model: { id: "m2", providerID: "p2" },
    cost: 0.5,
    title: "new-title",
  });
  assert.deepEqual(base, before);
});

test("applyUpdate: updates slug when info provides a new one", () => {
  const base = applyUpdate(null, {
    id: "ses_a",
    slug: "original-slug",
    model: { id: "m", providerID: "p" },
  });
  assert.equal(base.slug, "original-slug");
  const updated = applyUpdate(base, {
    id: "ses_a",
    slug: "new-slug",
    model: { id: "m", providerID: "p" },
  });
  assert.equal(updated.slug, "new-slug");
});

test("applyUpdate: preserves existing slug when info.slug is missing", () => {
  const base = applyUpdate(null, {
    id: "ses_a",
    slug: "kept-slug",
    model: { id: "m", providerID: "p" },
  });
  const updated = applyUpdate(base, {
    id: "ses_a",
    model: { id: "m", providerID: "p" },
  });
  assert.equal(updated.slug, "kept-slug");
});

test("applyUpdate: preserves existing slug when info.slug is empty string", () => {
  const base = applyUpdate(null, {
    id: "ses_a",
    slug: "kept-slug",
    model: { id: "m", providerID: "p" },
  });
  const updated = applyUpdate(base, {
    id: "ses_a",
    slug: "",
    model: { id: "m", providerID: "p" },
  });
  assert.equal(updated.slug, "kept-slug");
});

test("applyUpdate: defends against missing info.slug", () => {
  const record = applyUpdate(null, {
    id: "ses_no_slug",
    slug: undefined,
    title: "t",
    model: { id: "m", providerID: "p" },
  });
  assert.equal(record.slug, "");
});

test("home: throws when HOME is unset", async () => {
  const saved = process.env.HOME;
  delete process.env.HOME;
  try {
    await assert.rejects(loadSession("ses_anything"), /HOME is not set/);
    await assert.rejects(saveSession({
      sessionID: "ses_anything",
      slug: "s",
      title: "t",
      models: [],
      totalCost: 0,
      directory: "",
      createdAt: 0,
    }), /HOME is not set/);
    await assert.rejects(migrateIfNeeded(), /HOME is not set/);
  } finally {
    process.env.HOME = saved;
  }
});

test("scheduleUpdate: chains work for same session complete", async () => {
  const promises = [
    scheduleUpdate("session.updated", {
      id: "ses_serial",
      slug: "s",
      model: { id: "m", providerID: "p" },
      cost: 0.1,
    }),
    scheduleUpdate("session.updated", {
      id: "ses_serial",
      slug: "s",
      model: { id: "m", providerID: "p" },
      cost: 0.2,
    }),
    scheduleUpdate("session.updated", {
      id: "ses_serial",
      slug: "s",
      model: { id: "m", providerID: "p" },
      cost: 0.3,
    }),
  ];
  await Promise.all(promises);
  const loaded = await loadSession("ses_serial");
  assert.ok(loaded);
  assert.equal(loaded.totalCost, 0.3);
  assert.equal(loaded.models[0].cost, 0.3);
});

test("scheduleUpdate: independent sessions run concurrently without interfering", async () => {
  await Promise.all([
    scheduleUpdate("session.updated", {
      id: "ses_a",
      slug: "s",
      model: { id: "m", providerID: "p" },
      cost: 0.1,
    }),
    scheduleUpdate("session.updated", {
      id: "ses_b",
      slug: "s",
      model: { id: "m", providerID: "p" },
      cost: 0.2,
    }),
  ]);
  const a = await loadSession("ses_a");
  const b = await loadSession("ses_b");
  assert.ok(a);
  assert.ok(b);
  assert.equal(a.sessionID, "ses_a");
  assert.equal(b.sessionID, "ses_b");
  assert.equal(a.totalCost, 0.1);
  assert.equal(b.totalCost, 0.2);
});

test("OC_SESSION_DEBUG=1 writes debug log", async () => {
  const saved = process.env.OC_SESSION_DEBUG;
  process.env.OC_SESSION_DEBUG = "1";
  try {
    await scheduleUpdate("session.updated", {
      id: "ses_debug",
      slug: "s",
      model: { id: "m", providerID: "p" },
      cost: 0.01,
    });
    const debugPath = join(tempHome, ".opencode-sessions-debug.jsonl");
    const text = await readFile(debugPath, "utf8");
    const lines = text.trim().split("\n");
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.eventType, "session.updated");
    assert.equal(entry.sessionID, "ses_debug");
    assert.equal(entry.info.cost, 0.01);
  } finally {
    if (saved === undefined) delete process.env.OC_SESSION_DEBUG;
    else process.env.OC_SESSION_DEBUG = saved;
  }
});

test("OC_SESSION_DEBUG not set: no debug log written", async () => {
  const saved = process.env.OC_SESSION_DEBUG;
  delete process.env.OC_SESSION_DEBUG;
  try {
    await scheduleUpdate("session.updated", {
      id: "ses_nodebug",
      slug: "s",
      model: { id: "m", providerID: "p" },
      cost: 0.01,
    });
    const debugPath = join(tempHome, ".opencode-sessions-debug.jsonl");
    await assert.rejects(stat(debugPath));
  } finally {
    if (saved === undefined) delete process.env.OC_SESSION_DEBUG;
    else process.env.OC_SESSION_DEBUG = saved;
  }
});

test("event handler: catches scheduleUpdate errors instead of propagating", async () => {
  type Hooks = { event: (input: { event: any }) => Promise<void>; dispose: () => Promise<void> };
  const hooks = await (plugin as unknown as (input: unknown) => Promise<Hooks>)(undefined);
  await assert.doesNotReject(
    hooks.event({
      event: {
        type: "session.created",
        properties: { info: { id: "../unsafe", slug: "s" } },
      },
    }),
  );
});

test("dispose: uses allSettled and resolves even when updates failed", async () => {
  type Hooks = { event: (input: { event: any }) => Promise<void>; dispose: () => Promise<void> };
  const hooks = await (plugin as unknown as (input: unknown) => Promise<Hooks>)(undefined);
  await hooks.event({
    event: {
      type: "session.created",
      properties: { info: { id: "../unsafe", slug: "s" } },
    },
  });
  await assert.doesNotReject(hooks.dispose());
});

test("bucketByDate: empty input returns []", () => {
  assert.deepEqual(bucketByDate([]), []);
});

test("bucketByDate: single record produces one bucket", () => {
  const r = applyUpdate(null, {
    id: "ses_a",
    slug: "s",
    model: { id: "m", providerID: "p" },
    cost: 0.42,
    time: { created: new Date(2026, 8, 13, 10, 30).getTime() },
  });
  const buckets = bucketByDate([r]);
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].date, "2026-09-13");
  assert.ok(Math.abs(buckets[0].cost - 0.42) < 1e-9);
  assert.equal(buckets[0].sessions, 1);
  assert.deepEqual(buckets[0].sessionIDs, ["ses_a"]);
});

test("bucketByDate: same-day records merge sessions and sum cost", () => {
  const r1 = applyUpdate(null, {
    id: "ses_a",
    slug: "s",
    model: { id: "m", providerID: "p" },
    cost: 0.1,
    time: { created: new Date(2026, 8, 13, 9, 0).getTime() },
  });
  const r2 = applyUpdate(null, {
    id: "ses_b",
    slug: "s",
    model: { id: "m", providerID: "p" },
    cost: 0.25,
    time: { created: new Date(2026, 8, 13, 23, 59).getTime() },
  });
  const buckets = bucketByDate([r1, r2]);
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].date, "2026-09-13");
  assert.equal(buckets[0].sessions, 2);
  assert.ok(Math.abs(buckets[0].cost - 0.35) < 1e-9);
  assert.deepEqual(buckets[0].sessionIDs, ["ses_a", "ses_b"]);
});

test("bucketByDate: cross-day records split into separate buckets sorted ascending", () => {
  const r1 = applyUpdate(null, {
    id: "ses_newest",
    slug: "s",
    model: { id: "m", providerID: "p" },
    cost: 0.5,
    time: { created: new Date(2026, 8, 15).getTime() },
  });
  const r2 = applyUpdate(null, {
    id: "ses_middle",
    slug: "s",
    model: { id: "m", providerID: "p" },
    cost: 0.2,
    time: { created: new Date(2026, 8, 14).getTime() },
  });
  const r3 = applyUpdate(null, {
    id: "ses_oldest",
    slug: "s",
    model: { id: "m", providerID: "p" },
    cost: 0.1,
    time: { created: new Date(2026, 8, 13).getTime() },
  });
  const buckets = bucketByDate([r1, r2, r3]);
  assert.deepEqual(
    buckets.map((b) => b.date),
    ["2026-09-13", "2026-09-14", "2026-09-15"],
  );
  assert.deepEqual(
    buckets.map((b) => b.sessionIDs[0]),
    ["ses_oldest", "ses_middle", "ses_newest"],
  );
  assert.equal(buckets[0].cost, 0.1);
  assert.equal(buckets[1].cost, 0.2);
  assert.equal(buckets[2].cost, 0.5);
});

test("bucketByDate: skips records with invalid createdAt", () => {
  const good = applyUpdate(null, {
    id: "ses_good",
    slug: "s",
    model: { id: "m", providerID: "p" },
    cost: 0.1,
    time: { created: new Date(2026, 8, 13).getTime() },
  });
  const badNaN = {
    ...good,
    sessionID: "ses_bad1",
    createdAt: Number.NaN,
  };
  const badInf = {
    ...good,
    sessionID: "ses_bad2",
    createdAt: Number.POSITIVE_INFINITY,
  };
  const badString = {
    ...good,
    sessionID: "ses_bad3",
    createdAt: "soon" as unknown as number,
  };
  const buckets = bucketByDate([good, badNaN, badInf, badString]);
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].date, "2026-09-13");
  assert.equal(buckets[0].sessions, 1);
  assert.deepEqual(buckets[0].sessionIDs, ["ses_good"]);
});

test("bucketByDate: skips records with non-finite totalCost", () => {
  const good = applyUpdate(null, {
    id: "ses_good",
    slug: "s",
    model: { id: "m", providerID: "p" },
    cost: 0.1,
    time: { created: new Date(2026, 8, 13).getTime() },
  });
  const badCost = {
    ...good,
    sessionID: "ses_badcost",
    totalCost: Number.NaN,
  };
  const buckets = bucketByDate([good, badCost]);
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].sessions, 1);
});

test("bucketByDate: uses local time zone, not UTC", () => {
  const offsetMin = new Date().getTimezoneOffset();
  if (offsetMin === 0) return;
  const isWest = offsetMin > 0;
  const utcTs = isWest
    ? Date.UTC(2026, 8, 14, 2, 0, 0)
    : Date.UTC(2026, 8, 14, 23, 0, 0);
  const d = new Date(utcTs);
  const pad = (n: number) => String(n).padStart(2, "0");
  const localDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const utcDate = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  assert.notEqual(localDate, utcDate, "test setup: local and UTC dates must differ");
  const r = applyUpdate(null, {
    id: "ses_late",
    slug: "s",
    model: { id: "m", providerID: "p" },
    cost: 0.1,
    time: { created: utcTs },
  });
  const buckets = bucketByDate([r]);
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].date, localDate);
});

test("bucketByDate: duplicate sessionID is accumulated rather than deduplicated", () => {
  const ts = new Date(2026, 8, 13, 10, 0).getTime();
  const r1 = applyUpdate(null, {
    id: "ses_dup",
    slug: "s",
    model: { id: "m", providerID: "p" },
    cost: 0.1,
    time: { created: ts },
  });
  const r2 = applyUpdate(null, {
    id: "ses_dup",
    slug: "s",
    model: { id: "m", providerID: "p" },
    cost: 0.2,
    time: { created: ts + 1000 },
  });
  const buckets = bucketByDate([r1, r2]);
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].sessions, 2);
  assert.deepEqual(buckets[0].sessionIDs, ["ses_dup", "ses_dup"]);
  assert.ok(Math.abs(buckets[0].cost - 0.3) < 1e-9);
});

test("bucketByDate: does not mutate input records", () => {
  const r = applyUpdate(null, {
    id: "ses_a",
    slug: "s",
    model: { id: "m", providerID: "p" },
    cost: 0.1,
    time: { created: new Date(2026, 8, 13).getTime() },
  });
  const before = JSON.parse(JSON.stringify(r));
  bucketByDate([r]);
  assert.deepEqual(r, before);
});

test("bucketByDate: skips null and undefined entries", () => {
  const ts = new Date(2026, 8, 13, 10, 0).getTime();
  const good = applyUpdate(null, {
    id: "ses_good",
    slug: "s",
    model: { id: "m", providerID: "p" },
    cost: 0.1,
    time: { created: ts },
  });
  const buckets = bucketByDate([
    good,
    null as unknown as never,
    undefined as unknown as never,
  ]);
  assert.equal(buckets.length, 1);
  assert.deepEqual(buckets[0].sessionIDs, ["ses_good"]);
});

test("bucketByDate: all-invalid input returns []", () => {
  const r = applyUpdate(null, {
    id: "ses_a",
    slug: "s",
    model: { id: "m", providerID: "p" },
    cost: 0.1,
    time: { created: new Date(2026, 8, 13).getTime() },
  });
  assert.deepEqual(
    bucketByDate([
      { ...r, sessionID: "ses_b1", createdAt: Number.NaN },
      { ...r, sessionID: "ses_b2", totalCost: Number.NaN },
      { ...r, sessionID: "ses_b3", createdAt: Number.POSITIVE_INFINITY },
      null as unknown as never,
    ]),
    [],
  );
});
