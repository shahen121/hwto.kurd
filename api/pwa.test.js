const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("PWA Manifest & Configuration validity", () => {
  const manifestPath = path.resolve(__dirname, "../public/manifest.webmanifest");
  assert.ok(fs.existsSync(manifestPath), "manifest.webmanifest must exist in public/");

  const content = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(content.display, "standalone", "Display mode must be standalone");
  assert.ok(Array.isArray(content.icons), "Manifest icons must be an array");
  assert.ok(
    content.icons.some((i) => i.sizes === "192x192"),
    "Manifest must include 192x192 icon",
  );
  assert.ok(
    content.icons.some((i) => i.sizes === "512x512"),
    "Manifest must include 512x512 icon",
  );
  assert.ok(
    content.icons.some((i) => i.purpose === "maskable"),
    "Manifest must include maskable icon",
  );
});

test("Index.html iOS Standalone, CSP & PWA Meta Tags", () => {
  const indexPath = path.resolve(__dirname, "../index.html");
  const html = fs.readFileSync(indexPath, "utf8");

  assert.ok(
    html.includes('name="apple-mobile-web-app-capable" content="yes"'),
    "Must include apple-mobile-web-app-capable meta tag",
  );
  assert.ok(
    html.includes('rel="manifest" href="manifest.webmanifest"'),
    "Must link to manifest.webmanifest",
  );
  assert.ok(
    html.includes('rel="apple-touch-icon"'),
    "Must include apple-touch-icon link",
  );
  assert.ok(
    html.includes("viewport-fit=cover"),
    "Viewport must include viewport-fit=cover for iPhone notch and home bar safe areas",
  );
  assert.ok(
    html.includes("form-action 'self' https:"),
    "CSP form-action must allow https: for Google OAuth redirects and Firebase Auth handlers",
  );
  assert.ok(
    html.includes("script-src 'self' file: https://apis.google.com"),
    "CSP script-src must allow Google and Firebase scripts for OAuth login without auth/internal-error",
  );
});

test("Service Worker existence and handlers", () => {
  const swPath = path.resolve(__dirname, "../public/sw.js");
  assert.ok(fs.existsSync(swPath), "public/sw.js must exist");

  const swContent = fs.readFileSync(swPath, "utf8");
  assert.ok(swContent.includes('addEventListener("install"'), "SW must handle install event");
  assert.ok(swContent.includes('addEventListener("activate"'), "SW must handle activate event");
  assert.ok(swContent.includes('addEventListener("fetch"'), "SW must handle fetch event");
});

test("Firebase Auth Redirect & PWA Helper exports", async () => {
  const fb = await import("../src/utils/firebase.js");
  assert.equal(typeof fb.signInWithGoogle, "function");
  assert.equal(typeof fb.signInWithGoogleRedirect, "function");
  assert.equal(typeof fb.checkRedirectResult, "function");

  const pwa = await import("../src/utils/pwa.js");
  assert.equal(typeof pwa.isStandalone, "function");
  assert.equal(typeof pwa.isIOS, "function");
  assert.equal(typeof pwa.isAndroid, "function");
  assert.equal(typeof pwa.registerServiceWorker, "function");
});

test("Mobile CSS navigation and phone layout rules", () => {
  const cssPath = path.resolve(__dirname, "../src/styles/global.css");
  const css = fs.readFileSync(cssPath, "utf8");

  assert.ok(
    css.includes(".sidebar-saved,") && css.includes("display: none !important;"),
    "Mobile layout must hide .sidebar-saved to prevent layout shift in bottom navigation",
  );
  assert.ok(
    css.includes(".sidebar-bottom {\n        display: contents !important;"),
    "Mobile layout must use display: contents on .sidebar-bottom for uniform button distribution",
  );
  assert.ok(
    css.includes(".episodes-grid {\n        grid-template-columns: 1fr !important;"),
    "Mobile layout must stack episode cards in 1 column on phone screens",
  );
});
