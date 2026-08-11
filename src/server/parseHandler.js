const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5";

// Shared by api/parse.js (Vercel) and the local Vite dev middleware.
export async function parseVocabText(promptText, apiKey) {
  if (!apiKey) {
    throw new Error("서버에 ANTHROPIC_API_KEY가 설정되지 않았어요.");
  }
  if (!promptText || !promptText.trim()) {
    throw new Error("추출할 텍스트가 비어있어요.");
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: promptText }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || `Anthropic API 오류 (${response.status})`;
    throw new Error(message);
  }
  return data;
}
