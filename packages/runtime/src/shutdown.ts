// Graceful shutdown (§5 + §8): stop accepting work, drain leases, close sockets.
//
// No process-wide handlers run at import time. Call installRejectionHandler() once
// from the service entrypoint if crash-safe logging is wanted.
export function installRejectionHandler(): void {
  process.on("unhandledRejection", (err) => {
    // Never crash silently; log and keep the watchdog-informed process alive for bounded recovery.
    console.error("unhandledRejection", err);
  });
}

export function onShutdown(signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"], drain: () => Promise<void>): void {
  let shuttingDown = false;
  for (const sig of signals) {
    process.on(sig, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      drain().then(
        () => process.exit(0),
        (err) => {
          console.error("drain failed", err);
          process.exit(1);
        },
      );
      // Hard stop if drain hangs (bounded recovery, never indefinite).
      setTimeout(() => process.exit(1), 15000).unref();
    });
  }
}
