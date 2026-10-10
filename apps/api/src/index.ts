import Fastify from "fastify";

// Phase 2 stub: health model distinguishes liveness vs readiness (§8).
// Full auth/session/CSRF/OAuth routes land in Phase 4.
const app = Fastify({ logger: true });

app.get("/healthz", async () => ({ ok: true, service: "api" }));

app.get("/readyz", async () => {
  // Phase 3: check postgres + bot gateway states. For now report unknown, never fake ok.
  return { dbReady: false, status: "init", note: "Phase 3 wires real readiness" };
});

const port = Number(process.env.API_PORT ?? 3001);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
