const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const app = require("../server.js");
const handleEmbedProxy = require("./embed-proxy.js");

test("Security: server.js handles DoS payloads cleanly without crashing", async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Invalid Host header
    const r1 = await fetch(base, { headers: { Host: "bad host:80" } });
    assert.equal(r1.status, 200);

    // 2. Malformed URI (%E0%A4%A)
    const r2 = await fetch(`${base}/%E0%A4%A`);
    assert.equal(r2.status, 400);
    assert.equal(r2.headers.get("content-type"), "text/plain; charset=utf-8");

    // Server is still alive for subsequent normal request
    const r3 = await fetch(`${base}/`);
    assert.equal(r3.status, 200);
  } finally {
    server.close();
  }
});

test("Security: embed-proxy blocks SSRF, unauthorized hosts, reflected XSS, and raw HTML", async () => {
  const server = http.createServer(handleEmbedProxy);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Reflected XSS attempt in ?url=
    const scriptAttempt = "<script>alert(1)</script>";
    const r1 = await fetch(`${base}/embed-proxy?url=${encodeURIComponent(scriptAttempt)}`);
    assert.equal(r1.status, 400);
    assert.equal(r1.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(r1.headers.get("x-content-type-options"), "nosniff");
    const body1 = await r1.text();
    assert.equal(body1.includes("<script>"), false);

    // 2. SSRF attempt against Cloud metadata
    const r2 = await fetch(`${base}/embed-proxy?url=http://169.254.169.254/latest/meta-data/`);
    assert.equal(r2.status, 403);
    assert.equal(r2.headers.get("content-type"), "text/plain; charset=utf-8");

    // 3. SSRF attempt against private RFC 1918 network
    const r3 = await fetch(`${base}/embed-proxy?url=http://192.168.1.1/admin`);
    assert.equal(r3.status, 403);

    // 5. SVG / executable document attempt in raw mode
    const extSvg = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "image/svg+xml" });
      res.end(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`);
    });
    await new Promise((resolve) => extSvg.listen(0, resolve));
    const svgPort = extSvg.address().port;
    try {
      process.env.EMBED_ALLOW_LOCALHOST = "1";
      const r5 = await fetch(`${base}/embed-proxy?raw=1&url=${encodeURIComponent(`http://127.0.0.1:${svgPort}/evil.svg`)}`);
      assert.equal(r5.status, 403);
      const t5 = await r5.text();
      assert.ok(t5.includes("not permitted in raw mode"));
    } finally {
      delete process.env.EMBED_ALLOW_LOCALHOST;
      extSvg.close();
    }

    // 6. Redirect to private IP from allowed host
    const redirectServer = http.createServer((req, res) => {
      res.writeHead(302, { Location: "http://192.168.1.1/admin" });
      res.end();
    });
    await new Promise((resolve) => redirectServer.listen(0, resolve));
    const redirPort = redirectServer.address().port;
    try {
      process.env.EMBED_ALLOW_LOCALHOST = "1";
      const r6 = await fetch(`${base}/embed-proxy?url=${encodeURIComponent(`http://127.0.0.1:${redirPort}/stream`)}`);
      assert.equal(r6.status, 403);
      const t6 = await r6.text();
      assert.ok(t6.includes("disallowed host blocked"));
    } finally {
      delete process.env.EMBED_ALLOW_LOCALHOST;
      redirectServer.close();
    }
  } finally {
    server.close();
  }
});

test("Security: vidcore and vidlink prevent open redirects and stream SSRF", async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. /embed//evil.com open redirect attempt
    const r1 = await fetch(`${base}/embed//evil.com`, { redirect: "manual" });
    assert.equal(r1.status, 302);
    const loc1 = r1.headers.get("location");
    assert.ok(loc1.startsWith("/"), "Location must remain on local origin");
    assert.ok(!loc1.startsWith("//"), "Location must not be protocol-relative redirect");

    // 2. /stream-proxy/ref/ to private IP
    const r2 = await fetch(`${base}/stream-proxy/ref/http/169.254.169.254/metadata`);
    assert.equal(r2.status, 403);

    const r3 = await fetch(`${base}/stream-proxy/ref/http/127.0.0.1:8080/secret`);
    assert.equal(r3.status, 403);

    // 3. Spoofed X-Forwarded-Host cannot bypass foreign origin check on football
    const r4 = await fetch(`${base}/api/football?endpoint=fixtures`, {
      headers: {
        Origin: "https://evil-attacker.com",
        "X-Forwarded-Host": "evil-attacker.com",
      },
    });
    assert.equal(r4.status, 403);
  } finally {
    server.close();
  }
});
