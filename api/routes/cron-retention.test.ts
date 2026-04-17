import test from "node:test";
import assert from "node:assert/strict";
import { runRetentionPipeline, type RetentionSupabase } from "./cron.js";

type Row = { id: string; updated_at?: string; deleted_at?: string | null; created_at?: string };

type FakeLog = {
  selects: Array<{ table: string; filters: Record<string, unknown>; limit: number }>;
  updates: Array<{ table: string; values: Record<string, unknown>; ids: string[] }>;
  deletes: Array<{ table: string; ids: string[] }>;
};

type FailureSpec = {
  on: "select" | "update" | "delete";
  table: string;
  after?: number;
  message: string;
};

function buildFake(tables: Record<string, Row[]>, failure?: FailureSpec) {
  const log: FakeLog = { selects: [], updates: [], deletes: [] };
  let selectCount = 0;
  let updateCount = 0;
  let deleteCount = 0;

  const shouldFail = (op: FailureSpec["on"], table: string, count: number): string | null => {
    if (!failure || failure.on !== op || failure.table !== table) return null;
    if ((failure.after ?? 0) >= count) return null;
    return failure.message;
  };

  const makeSelect = (table: string) => {
    const filters: Record<string, unknown> = {};
    let lim = Infinity;
    const q: any = {
      is(col: string, val: null) { filters[`is:${col}`] = val; return q; },
      lt(col: string, val: string) { filters[`lt:${col}`] = val; return q; },
      limit(n: number) { lim = n; return q; },
      then(resolve: (v: { data: Row[] | null; error: { message: string } | null }) => void) {
        selectCount += 1;
        const err = shouldFail("select", table, selectCount);
        log.selects.push({ table, filters: { ...filters }, limit: lim });
        if (err) { resolve({ data: null, error: { message: err } }); return; }
        const rows = (tables[table] ?? []).filter((row) => {
          if ("is:deleted_at" in filters && row.deleted_at != null) return false;
          if ("lt:updated_at" in filters) {
            if (!row.updated_at || row.updated_at >= (filters["lt:updated_at"] as string)) return false;
          }
          if ("lt:deleted_at" in filters) {
            if (!row.deleted_at || row.deleted_at >= (filters["lt:deleted_at"] as string)) return false;
          }
          if ("lt:created_at" in filters) {
            if (!row.created_at || row.created_at >= (filters["lt:created_at"] as string)) return false;
          }
          return true;
        }).slice(0, lim);
        resolve({ data: rows.map((r) => ({ id: r.id })), error: null });
      },
    };
    return q;
  };

  const makeUpdate = (table: string, values: Record<string, unknown>) => {
    const filters: Record<string, unknown> = {};
    let ids: string[] = [];
    const q: any = {
      in(_col: string, vals: string[]) { ids = vals; return q; },
      is(col: string, val: null) { filters[`is:${col}`] = val; return q; },
      then(resolve: (v: { error: { message: string } | null }) => void) {
        updateCount += 1;
        const err = shouldFail("update", table, updateCount);
        log.updates.push({ table, values, ids });
        if (err) { resolve({ error: { message: err } }); return; }
        const rows = tables[table] ?? [];
        for (const row of rows) {
          if (!ids.includes(row.id)) continue;
          if ("is:deleted_at" in filters && row.deleted_at != null) continue;
          Object.assign(row, values);
        }
        resolve({ error: null });
      },
    };
    return q;
  };

  const makeDelete = (table: string) => {
    let ids: string[] = [];
    const q: any = {
      in(_col: string, vals: string[]) { ids = vals; return q; },
      is() { return q; },
      then(resolve: (v: { error: { message: string } | null }) => void) {
        deleteCount += 1;
        const err = shouldFail("delete", table, deleteCount);
        log.deletes.push({ table, ids });
        if (err) { resolve({ error: { message: err } }); return; }
        tables[table] = (tables[table] ?? []).filter((row) => !ids.includes(row.id));
        resolve({ error: null });
      },
    };
    return q;
  };

  const client: RetentionSupabase = {
    from(table: string) {
      return {
        select: () => makeSelect(table),
        update: (values: Record<string, unknown>) => makeUpdate(table, values),
        delete: () => makeDelete(table),
      } as any;
    },
  };
  return { client, log, tables };
}

const NOW = Date.parse("2026-04-17T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const CONFIG = { retentionDays: 365, graceDays: 30, auditDays: 90 };

test("retention pipeline: happy path soft-deletes, hard-deletes, and purges audit rows", async () => {
  const tables = {
    uk_chat_conversations: [
      { id: "stale-1", updated_at: new Date(NOW - 400 * DAY).toISOString(), deleted_at: null },
      { id: "stale-2", updated_at: new Date(NOW - 800 * DAY).toISOString(), deleted_at: null },
      { id: "fresh", updated_at: new Date(NOW - 10 * DAY).toISOString(), deleted_at: null },
      { id: "expired", updated_at: new Date(NOW - 500 * DAY).toISOString(), deleted_at: new Date(NOW - 90 * DAY).toISOString() },
      { id: "recent-soft", updated_at: new Date(NOW - 500 * DAY).toISOString(), deleted_at: new Date(NOW - 5 * DAY).toISOString() },
    ],
    uk_chat_admin_audit_log: [
      { id: "old-log", created_at: new Date(NOW - 200 * DAY).toISOString() },
      { id: "new-log", created_at: new Date(NOW - 10 * DAY).toISOString() },
    ],
  };
  const { client, log } = buildFake(tables);
  const result = await runRetentionPipeline(client, CONFIG, { now: NOW });

  assert.equal(result.error, undefined);
  assert.equal(result.softDeleted, 2, "both stale rows soft-deleted");
  assert.equal(result.hardDeleted, 1, "only grace-expired row hard-deleted");
  assert.equal(result.auditPurged, 1, "only old audit row purged");
  assert.equal(result.truncated, false);
  assert.deepEqual(log.deletes.map((d) => ({ table: d.table, ids: d.ids })), [
    { table: "uk_chat_conversations", ids: ["expired"] },
    { table: "uk_chat_admin_audit_log", ids: ["old-log"] },
  ]);
});

test("retention pipeline: select error returns error with partial counts preserved", async () => {
  const tables = {
    uk_chat_conversations: [{ id: "x", updated_at: new Date(NOW - 500 * DAY).toISOString(), deleted_at: null }],
    uk_chat_admin_audit_log: [],
  };
  const { client } = buildFake(tables, { on: "select", table: "uk_chat_admin_audit_log", message: "boom" });
  const result = await runRetentionPipeline(client, CONFIG, { now: NOW });
  assert.equal(result.error, "boom");
  assert.equal(result.softDeleted, 1, "soft-delete completed before audit select failed");
  assert.equal(result.auditPurged, 0);
});

test("retention pipeline: update error surfaces error and halts pipeline", async () => {
  const tables = {
    uk_chat_conversations: [{ id: "x", updated_at: new Date(NOW - 500 * DAY).toISOString(), deleted_at: null }],
    uk_chat_admin_audit_log: [{ id: "a", created_at: new Date(NOW - 500 * DAY).toISOString() }],
  };
  const { client, log } = buildFake(tables, { on: "update", table: "uk_chat_conversations", message: "update-fail" });
  const result = await runRetentionPipeline(client, CONFIG, { now: NOW });
  assert.equal(result.error, "update-fail");
  assert.equal(result.softDeleted, 0);
  assert.equal(log.deletes.length, 0, "no deletes should run after soft-delete update fails");
});

test("retention pipeline: loops multiple batches until empty", async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    id: `s${i}`,
    updated_at: new Date(NOW - 500 * DAY).toISOString(),
    deleted_at: null as string | null,
  }));
  const tables = { uk_chat_conversations: rows, uk_chat_admin_audit_log: [] };
  const { client } = buildFake(tables);
  const result = await runRetentionPipeline(client, CONFIG, { now: NOW, softDeleteBatchSize: 2 });

  assert.equal(result.error, undefined);
  assert.equal(result.softDeleted, 5);
  assert.equal(result.iterations.softDelete, 3, "2 + 2 + 1 partial batch");
  assert.equal(result.truncated, false);
});

test("retention pipeline: marks truncated when iteration cap hits", async () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    id: `s${i}`,
    updated_at: new Date(NOW - 500 * DAY).toISOString(),
    deleted_at: null as string | null,
  }));
  const tables = { uk_chat_conversations: rows, uk_chat_admin_audit_log: [] };
  const { client } = buildFake(tables);
  const result = await runRetentionPipeline(client, CONFIG, {
    now: NOW,
    softDeleteBatchSize: 2,
    maxIterations: 2,
  });

  assert.equal(result.iterations.softDelete, 2);
  assert.equal(result.softDeleted, 4);
  assert.equal(result.truncated, true, "cap reached on full batch marks truncated");
});

test("retention pipeline: budget exhausted before first batch marks truncated", async () => {
  const tables = {
    uk_chat_conversations: [{ id: "x", updated_at: new Date(NOW - 500 * DAY).toISOString(), deleted_at: null }],
    uk_chat_admin_audit_log: [],
  };
  const { client } = buildFake(tables);
  const result = await runRetentionPipeline(client, CONFIG, { now: NOW, budgetMs: -1 });
  assert.equal(result.truncated, true);
  assert.equal(result.softDeleted, 0);
  assert.equal(result.hardDeleted, 0);
  assert.equal(result.auditPurged, 0);
});
