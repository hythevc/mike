import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createWordAddinServer } from "./server.mjs";

let backend;
let addin;
let backendOrigin;
let addinOrigin;
let staticRoot;
let observedRequest;

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

before(async () => {
  staticRoot = await mkdtemp(path.join(os.tmpdir(), "mike-word-host-"));
  await writeFile(
    path.join(staticRoot, "taskpane.html"),
    "<!doctype html><title>Mike Word</title>",
  );

  backend = http.createServer((req, res) => {
    observedRequest = {
      url: req.url,
      cookie: req.headers.cookie,
      origin: req.headers.origin,
      forwardedHost: req.headers["x-forwarded-host"],
      forwardedFor: req.headers["x-forwarded-for"],
      forwarded: req.headers.forwarded,
    };
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "set-cookie": [
        "__Host-mike-session=one; Path=/; Secure; HttpOnly",
        "__Host-mike-session.1=two; Path=/; Secure; HttpOnly",
      ],
    });
    res.write("data: first\n\n");
    setImmediate(() => res.end("data: second\n\n"));
  });
  backendOrigin = await listen(backend);
  addin = createWordAddinServer({
    distRoot: staticRoot,
    backendOrigin,
  });
  addinOrigin = await listen(addin);
});

after(async () => {
  await Promise.all([close(addin), close(backend)]);
  await rm(staticRoot, { recursive: true, force: true });
});

test("serves health and the task pane", async () => {
  const health = await fetch(`${addinOrigin}/health`);
  assert.deepEqual(await health.json(), { ok: true });

  const taskpane = await fetch(`${addinOrigin}/`);
  assert.equal(taskpane.status, 200);
  assert.match(await taskpane.text(), /Mike Word/);
});

test("streams the API while preserving auth headers and cookies", async () => {
  const response = await fetch(`${addinOrigin}/api/chat?mode=word`, {
    headers: {
      cookie: "__Host-mike-session=incoming",
      origin: "https://word.example.test",
    },
  });

  assert.equal(await response.text(), "data: first\n\ndata: second\n\n");
  assert.deepEqual(observedRequest, {
    url: "/chat?mode=word",
    cookie: "__Host-mike-session=incoming",
    origin: "https://word.example.test",
    forwardedHost: new URL(addinOrigin).host,
    forwardedFor: "127.0.0.1",
    forwarded: undefined,
  });
  assert.deepEqual(response.headers.getSetCookie(), [
    "__Host-mike-session=one; Path=/; Secure; HttpOnly",
    "__Host-mike-session.1=two; Path=/; Secure; HttpOnly",
  ]);
});

// The API rate-limits by the address in X-Forwarded-For, so the host must
// never relay one the client wrote.
test("forwards the connecting address, never a client-supplied one", async () => {
  await fetch(`${addinOrigin}/api/auth/login`, {
    method: "POST",
    headers: {
      "x-forwarded-for": "198.51.100.66",
      forwarded: "for=198.51.100.66",
    },
    body: "{}",
  });

  assert.equal(observedRequest.forwardedFor, "127.0.0.1");
  assert.equal(observedRequest.forwarded, undefined);
});

test("forwards the configured edge header's address", async () => {
  const behindEdge = createWordAddinServer({
    distRoot: staticRoot,
    backendOrigin,
    clientIpHeader: "CF-Connecting-IP",
  });
  const origin = await listen(behindEdge);
  try {
    await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: {
        "cf-connecting-ip": "203.0.113.7",
        "x-forwarded-for": "198.51.100.66",
      },
      body: "{}",
    });
    assert.equal(observedRequest.forwardedFor, "203.0.113.7");

    await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "cf-connecting-ip": "not-an-address" },
      body: "{}",
    });
    assert.equal(observedRequest.forwardedFor, undefined);
  } finally {
    await close(behindEdge);
  }
});

test("rejects a client address setting that is not a header name", () => {
  assert.throws(
    () =>
      createWordAddinServer({
        distRoot: staticRoot,
        backendOrigin,
        clientIpHeader: "client ip",
      }),
    /CLIENT_IP_HEADER must be an HTTP header name/,
  );
});

test("rejects backend configuration that is not an origin", () => {
  for (const backendOrigin of [
    "https://backend.example.test/path",
    "https://backend.example.test?target=other",
    "https://user:password@backend.example.test",
  ]) {
    assert.throws(
      () => createWordAddinServer({ distRoot: staticRoot, backendOrigin }),
      /must be an http\(s\) origin/,
    );
  }
});
