function restoreEnglishMetadata(
  body,
  englishBody,
  { includeOverview = false } = {},
) {
  if (!body || !englishBody) return body;

  const copyEnglishFields = (localizedItems, englishItems) => {
    const englishById = new Map(englishItems.map((item) => [item.id, item]));
    localizedItems.forEach((item) => {
      const englishItem = englishById.get(item.id);
      if (!englishItem) return;
      if (englishItem.title) item.title = englishItem.title;
      if (englishItem.name) item.name = englishItem.name;
    });
  };

  if (Array.isArray(body.results) && Array.isArray(englishBody.results)) {
    copyEnglishFields(body.results, englishBody.results);
  } else if (Array.isArray(body.parts) && Array.isArray(englishBody.parts)) {
    copyEnglishFields(body.parts, englishBody.parts);
  } else {
    if (englishBody.title) body.title = englishBody.title;
    if (englishBody.name) body.name = englishBody.name;
    if (englishBody.overview) {
      if (includeOverview) {
        body.overview_en = englishBody.overview;
      } else if (!body.overview || !body.overview.trim()) {
        body.overview = englishBody.overview;
      }
    }
  }

  return body;
}

module.exports = { restoreEnglishMetadata };
