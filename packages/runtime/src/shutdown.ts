// Graceful shutdown (§5 + §8): stop accepting work, drain leases, close sockets.
export function onShutdown(signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"], drain: () => Promise<void>): void {
  let shuttingDown = false;
  for (const sig of signals) {
    process.on(sig, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      drain()
        .catch((err) => console.error("drain failed", err))
        .finally(() => process.exit(0));
      // Hard stop if drain hangs (bounded recovery, never indefinite).
      setTimeout(() => process.exit(1), 15000).unref();
    });
  }
}

process.on("unhandledRejection", (err) => {
  // Never crash silently; log and keep the watchdog-informed process alive for bounded recovery.
  console.error("unhandledRejection", err);
});
