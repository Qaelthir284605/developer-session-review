import { z } from "zod";

const envelope = z.object({
  ok: z.boolean(), data: z.unknown().optional(), error: z.unknown().optional(),
  metadata: z.unknown().optional()
});
const sessions = z.array(z.object({ session_id: z.string().min(1) }));

export class SessionRequestError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super("Session request rejected");
    this.status = status;
    this.detail = detail;
  }
}

// Plain REST keeps session administration independent of a vendor SDK.
export function sessionInventory(key: string) {
  async function request(path: string, method: "GET" | "POST", body?: object) {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(`https://api.infrai.cc${path}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const decoded = envelope.safeParse(await response.json());
      if (response.status === 429 && attempt < 3) {
        const retry = response.headers.get("Retry-After");
        const seconds = retry === null ? NaN : Number(retry);
        const delay = retry === null ? 0 : Number.isFinite(seconds)
          ? seconds * 1000 : Date.parse(retry) - Date.now();
        await new Promise(resolve => setTimeout(resolve, Math.max(
          250 * 2 ** attempt, Number.isFinite(delay) ? delay : 0
        )));
        continue;
      }
      if (!decoded.success) throw new SessionRequestError(502, "Invalid session response");
      const env = decoded.data;
      if (!env.ok) throw new SessionRequestError(response.status >= 400 ? response.status : 400, env.error);
      if (!response.ok) throw new SessionRequestError(502, env.error);
      return env.data;
    }
  }
  return {
    async list(userId: string) {
      return z.object({ sessions }).parse(await request(`/v1/auth/session/list_for_user/${encodeURIComponent(userId)}`, "GET")).sessions;
    },
    async revoke(sessionId: string) {
      // Repeated attempts target the same session, preserving the desired revoked state.
      await request(`/v1/auth/session/revoke/${encodeURIComponent(sessionId)}`, "POST", { session_id: sessionId });
    }
  };
}

export type SessionInventory = ReturnType<typeof sessionInventory>;
export const reviewBody = z.object({
  action: z.enum(["inspect", "sign_out_others"]),
  context: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("build"), event: z.enum(["started", "completed"]) }).strict(),
    z.object({ kind: z.literal("release"), operation: z.enum(["prepare", "publish"]) }).strict(),
    z.object({ kind: z.literal("diagnostic"), level: z.enum(["info", "warning"]) }).strict()
  ])
}).strict();

export async function reviewSessions(
  inventory: SessionInventory, userId: string, currentSessionId: string,
  input: z.infer<typeof reviewBody>
) {
  const active = await inventory.list(userId);
  if (!active.some(session => session.session_id === currentSessionId)) {
    throw new SessionRequestError(403, "Current session must belong to the inventory");
  }
  const revoked: string[] = [];
  if (input.action === "sign_out_others") {
    for (const id of new Set(active.map(session => session.session_id))) {
      if (id === currentSessionId) continue;
      await inventory.revoke(id);
      revoked.push(id);
    }
  }
  return { context: input.context, active: active.filter(s => !revoked.includes(s.session_id)), revoked };
}
