const { test } = require("node:test");
const assert = require("node:assert/strict");

test("starting eleven are arranged by their real pitch positions", async () => {
  const { createServer } = require("vite");
  const server = await createServer({
    configFile: false,
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
  });

  try {
    const { getFormationRows } = await server.ssrLoadModule(
      "/src/utils/sportLineup.js",
    );
    const rows = getFormationRows([
      {
        starter: true,
        formationPlace: "1",
        position: { abbreviation: "G", displayName: "Goalkeeper" },
        athlete: { displayName: "Keeper" },
      },
      {
        starter: true,
        formationPlace: "6",
        position: { abbreviation: "CD-R", displayName: "Center Right Defender" },
        athlete: { displayName: "Center Back" },
      },
      {
        starter: true,
        formationPlace: "3",
        position: { abbreviation: "LB", displayName: "Left Back" },
        athlete: { displayName: "Fullback" },
      },
      {
        starter: true,
        formationPlace: "8",
        position: { abbreviation: "AM-R", displayName: "Attacking Midfielder Right" },
        athlete: { displayName: "Attacking midfielder" },
      },
      {
        starter: true,
        formationPlace: "11",
        position: { abbreviation: "F", displayName: "Forward" },
        athlete: { displayName: "Striker" },
      },
      {
        starter: true,
        formationPlace: "12",
        position: { abbreviation: "X", displayName: "Unknown position" },
        athlete: { displayName: "Unplaced player" },
      },
      {
        starter: false,
        formationPlace: "13",
        position: { abbreviation: "F", displayName: "Forward" },
        athlete: { displayName: "Substitute" },
      },
    ]);

    assert.deepEqual(
      rows.map((row) => row.players.map((player) => player.athlete.displayName)),
      [
        ["Keeper"],
        ["Fullback", "Center Back"],
        ["Attacking midfielder"],
        ["Striker"],
        ["Unplaced player"],
      ],
    );
  } finally {
    await server.close();
  }
});
