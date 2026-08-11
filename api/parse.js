import { parseVocabText } from "../src/server/parseHandler.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const { text } = req.body || {};
    const data = await parseVocabText(text, process.env.ANTHROPIC_API_KEY);
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || "서버 오류가 발생했어요." });
  }
}
