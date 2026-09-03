import { createServer } from "node:http";
import { handleRequest } from "./src/index.js";

const port = Number(process.env.PORT || 8787);
const env = {
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
    || "http://127.0.0.1:8765,http://localhost:8765,http://127.0.0.1:8787",
  OWNER_PASSWORD: process.env.OWNER_PASSWORD || "",
  OWNER_USER: process.env.OWNER_USER || "",
  OWNER_PWD: process.env.OWNER_PWD || "",
};

createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const response = await handleRequest(request, env, fetch);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => {
  console.log(`guest worker mock listening on http://127.0.0.1:${port}`);
});
