const { ipcMain } = require("electron");

let _hlsCore = null;
async function getHlsCore() {
  if (!_hlsCore) {
    _hlsCore = await import("../lib/hlsCore.js");
  }
  return _hlsCore;
}

function register() {
  ipcMain.handle("resolve-hls-stream", async (_, args) => {
    try {
      const core = await getHlsCore();
      const res = await core.resolveAuthorizedHls(args || {});
      return res;
    } catch (err) {
      return { status: 500, error: err?.message || "Internal HLS resolution error" };
    }
  });
}

module.exports = { register };
