export function getAnimeSeasonTranslationKey(season) {
  if (typeof season !== "string") return "";
  const keys = {
    WINTER: "animeWinter",
    SPRING: "animeSpring",
    SUMMER: "animeSummer",
    FALL: "animeFall",
  };
  return keys[season.trim().toUpperCase()] || "";
}
