const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { writeBundledWorkflows, installBundledWorkflows } = require("./workflows");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mike-workflow-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from("Example reference document");
  const temporaryPath = path.join(root, "source.txt");
  await fs.writeFile(temporaryPath, bytes);
  const document = {
    source_repository: "Open-Legal-Products/mike-workflows", source_ref: "main", source_commit: "a".repeat(40),
    workflows: [{ workflow_key: "example", title: "Example", content_hash: "e".repeat(64), assets: [{
      filename: "reference.txt", file_type: "txt", size_bytes: bytes.length,
      content_hash: createHash("sha256").update(bytes).digest("hex"), temporary_path: temporaryPath,
    }] }],
  };
  const destination = path.join(root, "dist/workflow-catalog");
  await writeBundledWorkflows(document, destination);
  // The original download can be removed before the app ever starts.
  await fs.rm(temporaryPath);
  const queries = [];
  // Nothing installed yet: no active catalog rows.
  const client = { query: async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; } };
  return { root, document, destination, queries, client, bytes };
}

// A client over a fake active catalog of `rows` ({ source_commit,
// content_hash }), recording every query. It answers a row or count read of
// the active catalog, optionally narrowed to one source commit, as Postgres
// would, so the test holds whichever way the install check asks.
function installedClient(rows) {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (!/from public\.mike_workflows where active/.test(sql)) return { rows: [] };
      const matching = /source_commit = \$1/.test(sql)
        ? rows.filter((row) => row.source_commit === params[0])
        : rows;
      return { rows: /count\(\*\)/.test(sql) ? [{ count: matching.length }] : matching };
    },
  };
}

test("bundled workflows install from portable files without network and use the existing atomic catalog RPC", async (t) => {
  const f = await fixture(t);
  await installBundledWorkflows({ client: f.client, backendDir: f.root, storageRoot: path.join(f.root, "storage") });
  assert.match(f.queries[1].sql, /replace_mike_workflows/);
  const payload = JSON.parse(f.queries[1].params[1]);
  const asset = payload[0].assets[0];
  assert.equal(asset.temporary_path, undefined);
  assert.deepEqual(await fs.readFile(path.join(f.root, "storage", asset.storage_path)), f.bytes);
  assert.equal(f.queries[1].params[0], f.document.source_commit);
});

test("unchanged bundled catalog does not rewrite installed workflows", async (t) => {
  const f = await fixture(t);
  const client = installedClient([
    { source_commit: f.document.source_commit, content_hash: f.document.workflows[0].content_hash },
  ]);
  await installBundledWorkflows({ client, backendDir: f.root, storageRoot: path.join(f.root, "storage") });
  assert.equal(client.queries.length, 1);
});

test("a bundle rebuilt from the same commit with a changed payload installs again", async (t) => {
  const f = await fixture(t);
  // Same commit and row count, but the rows predate the new payload fields,
  // so their content hashes differ from the bundle's.
  const client = installedClient([{ source_commit: f.document.source_commit, content_hash: "f".repeat(64) }]);
  await installBundledWorkflows({ client, backendDir: f.root, storageRoot: path.join(f.root, "storage") });
  assert.equal(client.queries.length, 2);
  assert.match(client.queries[1].sql, /replace_mike_workflows/);
  assert.equal(JSON.parse(client.queries[1].params[1])[0].content_hash, f.document.workflows[0].content_hash);
});

test("an active catalog from another commit is replaced by the bundle", async (t) => {
  const f = await fixture(t);
  const client = installedClient([
    { source_commit: "b".repeat(40), content_hash: f.document.workflows[0].content_hash },
  ]);
  await installBundledWorkflows({ client, backendDir: f.root, storageRoot: path.join(f.root, "storage") });
  assert.match(client.queries[1].sql, /replace_mike_workflows/);
});

test("corrupt bundled assets stop startup before any database catalog replacement", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.destination, "assets", f.document.workflows[0].assets[0].content_hash), "corrupt");
  await assert.rejects(installBundledWorkflows({ client: f.client, backendDir: f.root, storageRoot: path.join(f.root, "storage") }), /integrity check/);
  assert.equal(f.queries.length, 1);
});

test("unsafe bundled asset names cannot write outside storage", async (t) => {
  const f = await fixture(t);
  const catalogPath = path.join(f.destination, "catalog.json");
  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  catalog.workflows[0].assets[0].filename = "../../outside";
  await fs.writeFile(catalogPath, JSON.stringify(catalog));
  await assert.rejects(installBundledWorkflows({ client: f.client, backendDir: f.root, storageRoot: path.join(f.root, "storage") }), /asset path is invalid/);
  assert.equal(f.queries.length, 1);
});
