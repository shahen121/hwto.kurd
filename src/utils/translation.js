const MYMEMORY_URL = "https://api.mymemory.translated.net/get";
const MAX_CHUNK_LENGTH = 450;

function splitText(text) {
  const chunks = [];
  let remaining = text.trim();

  while (remaining.length > MAX_CHUNK_LENGTH) {
    let splitAt = remaining.lastIndexOf(" ", MAX_CHUNK_LENGTH);
    if (splitAt < MAX_CHUNK_LENGTH / 2) {
      splitAt = MAX_CHUNK_LENGTH;
    }
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

async function translateChunk(text) {
  const params = new URLSearchParams({
    q: text,
    langpair: "en|ckb",
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${MYMEMORY_URL}?${params}`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Translation service returned ${response.status}`);
    }

    const result = await response.json();
    const translatedText = result?.responseData?.translatedText;
    if (
      result?.responseStatus !== 200 ||
      typeof translatedText !== "string" ||
      !translatedText.trim()
    ) {
      throw new Error("Translation service returned no translated text");
    }
    return translatedText.trim();
  } finally {
    clearTimeout(timeout);
  }
}

export async function translateToSorani(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new TypeError("A non-empty synopsis is required");
  }

  const chunks = splitText(text);
  const translated = [];
  for (const chunk of chunks) {
    translated.push(await translateChunk(chunk));
  }
  return translated.join(" ");
}
