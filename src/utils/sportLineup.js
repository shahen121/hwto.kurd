const POSITION_LINES = [
  {
    key: "goalkeeper",
    matches: (abbreviation, displayName) =>
      /^(G|GK)$/.test(abbreviation) || /goalkeeper|goal keeper/.test(displayName),
  },
  {
    key: "defenders",
    matches: (abbreviation, displayName) =>
      /^(D|CB|CD|LB|RB|LWB|RWB|WB|SW)([-_].*)?$/.test(abbreviation) ||
      /defender|back/.test(displayName),
  },
  {
    key: "midfielders",
    matches: (abbreviation, displayName) =>
      /^(AM|CAM|DM|CDM|CM|LM|RM|M|WM)([-_].*)?$/.test(abbreviation) ||
      /midfielder|midfield/.test(displayName),
  },
  {
    key: "forwards",
    matches: (abbreviation, displayName) =>
      /^(F|FW|ST|CF|SS|LW|RW)([-_].*)?$/.test(abbreviation) ||
      /forward|striker/.test(displayName),
  },
];

function getPositionLine(player) {
  const abbreviation = String(player.position?.abbreviation || "")
    .trim()
    .toUpperCase();
  const displayName = String(
    player.position?.displayName || player.position?.name || "",
  )
    .trim()
    .toLowerCase();

  return POSITION_LINES.find((line) =>
    line.matches(abbreviation, displayName),
  )?.key;
}

function sortByFormationPlace(players) {
  return players
    .map((player, index) => ({ player, index }))
    .sort((left, right) => {
      const leftPlace = Number(left.player.formationPlace);
      const rightPlace = Number(right.player.formationPlace);
      const leftHasPlace = Number.isFinite(leftPlace);
      const rightHasPlace = Number.isFinite(rightPlace);

      if (leftHasPlace && rightHasPlace && leftPlace !== rightPlace) {
        return leftPlace - rightPlace;
      }
      if (leftHasPlace !== rightHasPlace) return leftHasPlace ? -1 : 1;
      return left.index - right.index;
    })
    .map(({ player }) => player);
}

export function getFormationRows(players = []) {
  const hasStarterFlags = players.some((player) => player.starter !== undefined);
  const starters = hasStarterFlags
    ? players.filter((player) => player.starter)
    : players.slice(0, 11);
  const groupedPlayers = new Map(
    POSITION_LINES.map(({ key }) => [key, []]),
  );
  const unplaced = [];

  starters.forEach((player) => {
    const line = getPositionLine(player);
    if (line) groupedPlayers.get(line).push(player);
    else unplaced.push(player);
  });

  return [
    ...POSITION_LINES.map(({ key }) => ({
      key,
      players: sortByFormationPlace(groupedPlayers.get(key)),
    })).filter(({ players: rowPlayers }) => rowPlayers.length > 0),
    ...(unplaced.length
      ? [{ key: "unplaced", players: sortByFormationPlace(unplaced) }]
      : []),
  ];
}
