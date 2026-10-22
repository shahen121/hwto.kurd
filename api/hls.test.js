import assert from "node:assert/strict";
import {
  isPrivateIp,
  isSafeUrl,
  checkRateLimit,
  getFromManifestCache,
  setInManifestCache,
  resolveAuthorizedHls,
} from "../src/lib/hlsCore.js";

async function runTests() {
  console.log("=== Running HLS Core & Security Tests ===");

  // 1. Test isPrivateIp
  console.log("Testing isPrivateIp...");
  assert.equal(isPrivateIp("127.0.0.1"), true, "127.0.0.1 must be private");
  assert.equal(isPrivateIp("127.255.255.255"), true, "127.x must be private");
  assert.equal(isPrivateIp("10.0.0.1"), true, "10.0.0.1 must be private");
  assert.equal(isPrivateIp("192.168.1.1"), true, "192.168.1.1 must be private");
  assert.equal(isPrivateIp("172.16.0.1"), true, "172.16.0.1 must be private");
  assert.equal(isPrivateIp("172.31.255.255"), true, "172.31.x must be private");
  assert.equal(isPrivateIp("169.254.169.254"), true, "169.254.169.254 must be private");
  assert.equal(isPrivateIp("100.64.0.1"), true, "100.64.x (CGNAT) must be private");
  assert.equal(isPrivateIp("100.127.255.255"), true, "100.127.x (CGNAT) must be private");
  assert.equal(isPrivateIp("224.0.0.1"), true, "224.x (Multicast) must be private");
  assert.equal(isPrivateIp("::1"), true, "IPv6 ::1 must be private");
  assert.equal(isPrivateIp("::"), true, "IPv6 :: must be private");
  assert.equal(isPrivateIp("fe80::1"), true, "IPv6 fe80:: must be private");
  assert.equal(isPrivateIp("fc00::1"), true, "IPv6 fc00:: must be private");
  assert.equal(isPrivateIp("fd12::1"), true, "IPv6 fd00:: must be private");
  assert.equal(isPrivateIp("::ffff:192.168.1.1"), true, "IPv4-mapped private must be private");

  assert.equal(isPrivateIp("8.8.8.8"), false, "8.8.8.8 must be public");
  assert.equal(isPrivateIp("1.1.1.1"), false, "1.1.1.1 must be public");
  assert.equal(isPrivateIp("142.250.190.46"), false, "Google IP must be public");
  console.log("✓ isPrivateIp tests passed.");

  // 2. Test isSafeUrl
  console.log("Testing isSafeUrl...");
  assert.equal(
    await isSafeUrl("http://cdn.example.com/test.m3u8", ["cdn.example.com"]),
    false,
    "HTTP (non-secure) must be rejected"
  );
  assert.equal(
    await isSafeUrl("https://unapproved.com/test.m3u8", ["cdn.example.com"]),
    false,
    "Host not in allowedHosts must be rejected"
  );
  assert.equal(
    await isSafeUrl("https://localhost/test.m3u8", ["localhost"]),
    false,
    "Localhost must be rejected even if listed"
  );
  assert.equal(
    await isSafeUrl("https://127.0.0.1/test.m3u8", ["127.0.0.1"]),
    false,
    "Loopback IP must be rejected even if listed"
  );
  // Real public host in allowed hosts
  assert.equal(
    await isSafeUrl("https://cloudflare.com/manifest.m3u8", ["cloudflare.com"]),
    true,
    "Allowed public HTTPS host must pass"
  );
  console.log("✓ isSafeUrl tests passed.");

  // 3. Test Rate Limiter
  console.log("Testing checkRateLimit...");
  const testIp = "198.51.100.42";
  for (let i = 0; i < 60; i++) {
    const res = checkRateLimit(testIp);
    assert.equal(res.allowed, true, `Request ${i + 1} should be allowed`);
  }
  const exceededRes = checkRateLimit(testIp);
  assert.equal(exceededRes.allowed, false, "Request 61 must be rate-limited");
  assert.ok(exceededRes.retryAfter > 0, "Retry-After must be positive number");
  console.log("✓ checkRateLimit tests passed.");

  // 4. Test Manifest Cache
  console.log("Testing Manifest Cache...");
  const testKey = "test_manifest_123";
  setInManifestCache(testKey, { streamUrl: "https://example.com/master.m3u8" }, 1000);
  const hit = getFromManifestCache(testKey);
  assert.ok(hit, "Cache hit expected");
  assert.equal(hit.data.streamUrl, "https://example.com/master.m3u8");

  // Negative cache test
  const negKey = "test_neg_456";
  setInManifestCache(negKey, { isNegative: true, status: 404, error: "Not Found" }, 1000);
  const negHit = getFromManifestCache(negKey);
  assert.ok(negHit?.data?.isNegative, "Negative cache hit expected");
  assert.equal(negHit.data.status, 404);
  console.log("✓ Manifest Cache tests passed.");

  // 5. Test resolveAuthorizedHls validation
  console.log("Testing resolveAuthorizedHls input validation...");
  // Missing configuration
  const noConfig = await resolveAuthorizedHls({ type: "movie", id: "550", providerUrl: "", providerToken: "" });
  assert.equal(noConfig.status, 503);

  // Invalid type
  const badType = await resolveAuthorizedHls({
    type: "invalid",
    id: "550",
    providerUrl: "https://example.com",
    providerToken: "token",
  });
  assert.equal(badType.status, 400);

  // Invalid ID format
  const badId = await resolveAuthorizedHls({
    type: "movie",
    id: "not_a_valid_id!@#",
    providerUrl: "https://example.com",
    providerToken: "token",
  });
  assert.equal(badId.status, 400);

  // Invalid season/ep
  const badEp = await resolveAuthorizedHls({
    type: "tv",
    id: "550",
    season: "season1",
    episode: "ep2",
    providerUrl: "https://example.com",
    providerToken: "token",
  });
  assert.equal(badEp.status, 400);

  console.log("✓ resolveAuthorizedHls validation tests passed.");
  console.log("=== All Tests Passed Successfully ===");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
