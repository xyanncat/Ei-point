import Fastify from "fastify";

// Phase 2 stub: health model distinguishes liveness vs readiness (§8).
// Full auth/session/CSRF/OAuth routes land in Phase 4.
const app = Fastify({ logger: true });

app.get("/healthz", async () => ({ ok: true, service: "api" }));

app.get("/readyz", async () => {
  // Phase 3: real DB readiness; gateway/provider states land with bot heartbeats (Phase 5+).
  const url = process.env.DATABASE_URL;
  if (url == null) return { dbReady: false, status: "init", note: "DATABASE_URL missing" };
  try {
    const { Client } = await import("pg");
    const db = new Client({ connectionString: url, connectionTimeoutMillis: 3000 });
    await db.connect();
    await db.query("SELECT 1");
    await db.end();
    return { dbReady: true, status: "ok" };
  } catch (err) {
    return { dbReady: false, status: "degraded", note: err instanceof Error ? err.message : String(err) };
  }
});

const port = Number(process.env.API_PORT ?? 3001);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
