import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { parseVocabText } from "./src/server/parseHandler.js";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      react(),
      {
        name: "local-api-parse",
        configureServer(server) {
          server.middlewares.use("/api/parse", (req, res) => {
            if (req.method !== "POST") {
              res.statusCode = 405;
              res.end(JSON.stringify({ error: "Method not allowed" }));
              return;
            }
            let body = "";
            req.on("data", (chunk) => {
              body += chunk;
            });
            req.on("end", async () => {
              try {
                const { text } = body ? JSON.parse(body) : {};
                const data = await parseVocabText(text, env.ANTHROPIC_API_KEY);
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(data));
              } catch (err) {
                res.statusCode = 500;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: err.message || "서버 오류가 발생했어요." }));
              }
            });
          });
        },
      },
    ],
  };
});
