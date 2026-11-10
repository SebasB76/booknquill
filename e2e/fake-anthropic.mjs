// Stands in for the Messages API in E2E runs, so formula conversion is tested without a real key or network.
import http from "node:http";

const ANSWERS = { "raiz de n sobre sigma": "$\\frac{\\sqrt{n}}{\\sigma}$" };
const port = Number(process.env.FAKE_ANTHROPIC_PORT ?? 1432);

http
  .createServer((req, res) => {
    if (req.method === "GET") return res.end("ok");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { model, messages } = JSON.parse(body);
      const text = ANSWERS[messages?.[0]?.content];
      const ok = req.url === "/v1/messages" && req.headers["x-api-key"] === "e2e-key" && model === "claude-haiku-5-5" && text;
      res.writeHead(ok ? 200 : 400, { "content-type": "application/json" });
      res.end(JSON.stringify(ok ? { content: [{ type: "text", text }], stop_reason: "end_turn" } : { error: { message: "unexpected request" } }));
    });
  })
  .listen(port, "127.0.0.1");
