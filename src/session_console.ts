import { createServer } from "node:http";
import { reviewBody, reviewSessions, sessionInventory, SessionRequestError } from "./session_inventory.ts";

const key = process.env.INFRAI_API_KEY;
if (!key) throw new Error("Set INFRAI_API_KEY");
const inventory = sessionInventory(key);

createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  try {
    if (request.method !== "POST" || request.url !== "/session-review") {
      response.writeHead(404).end(JSON.stringify({ error: "Route not found" }));
      return;
    }
    // The authenticated gateway supplies these headers; bind only to loopback.
    const userId = request.headers["x-user-id"];
    const sessionId = request.headers["x-session-id"];
    if (typeof userId !== "string" || typeof sessionId !== "string") {
      response.writeHead(401).end(JSON.stringify({ error: "Authenticated session required" }));
      return;
    }
    let body = "";
    for await (const chunk of request) {
      body += chunk.toString();
      if (Buffer.byteLength(body) > 8192) {
        response.writeHead(413).end(JSON.stringify({ error: "Request too large" }));
        return;
      }
    }
    let json: unknown;
    try { json = JSON.parse(body); } catch {
      response.writeHead(400).end(JSON.stringify({ error: "Expected JSON" }));
      return;
    }
    const input = reviewBody.safeParse(json);
    if (!input.success) {
      response.writeHead(400).end(JSON.stringify({ error: "Invalid session review" }));
      return;
    }
    const result = await reviewSessions(inventory, userId, sessionId, input.data);
    response.writeHead(200).end(JSON.stringify(result));
  } catch (error) {
    const status = error instanceof SessionRequestError ? error.status : 502;
    response.writeHead(status).end(JSON.stringify({
      error: error instanceof SessionRequestError ? error.detail : "Session review could not complete"
    }));
  }
}).listen(3000, "127.0.0.1", () => console.log("Session review: http://127.0.0.1:3000"));
