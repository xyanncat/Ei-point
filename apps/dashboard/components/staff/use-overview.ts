"use client";
// Overview data: fetch + 30s refresh + visibility refresh + abort handling.
// Extracted from the old command center so every page shares one pattern.
import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardOverview } from "@ei-point/contracts";
import { api, ApiError } from "../../lib/api";
import { useStaff } from "./staff-context";

export function useOverview() {
  const { guild, boot } = useStaff();
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const handleError = useCallback((err: unknown) => {
    setError(
      err instanceof Error && err.name !== "TimeoutError"
        ? err.message
        : "The request timed out. Please retry.",
    );
    setReference(err instanceof ApiError ? (err.correlationId ?? "") : "");
  }, []);

  const refresh = useCallback(async () => {
    if (!guild) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const ticket = ++generation.current;
    const timeout = setTimeout(
      () => request.abort(new DOMException("Request timed out", "TimeoutError")),
      20000,
    );
    setBusy(true);
    setError("");
    setReference("");
    try {
      const next = await api<DashboardOverview>(
        `/api/overview?guildId=${encodeURIComponent(guild)}`,
        { signal: request.signal },
      );
      if (ticket === generation.current) setData(next);
    } catch (err) {
      if (
        ticket === generation.current &&
        (!request.signal.aborted || request.signal.reason?.name === "TimeoutError")
      ) {
        if (err instanceof ApiError && err.status === 403) setData(null);
        handleError(err);
      }
    } finally {
      clearTimeout(timeout);
      if (ticket === generation.current) setBusy(false);
    }
  }, [guild, handleError]);

  useEffect(() => {
    setData(null);
    if (boot !== "ready" || !guild) return;
    void refresh();
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(visible, 30000);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      controller.current?.abort();
      generation.current++;
    };
  }, [boot, guild, refresh]);

  return { data, busy, error, reference, refresh, fresh: Boolean(data) && !error && !data?.stale };
}
