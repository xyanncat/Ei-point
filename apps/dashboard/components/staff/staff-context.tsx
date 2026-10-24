"use client";
// Staff workspace context: account, server selection and permission flags.
// Server selection is preserved in the URL (?server=) so links are shareable
// and Back/refresh keep the workspace (owner brief 2026-10-18).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { GuildInfo, Role } from "@ei-point/contracts";
import {
  api,
  ApiError,
  getRolePreview,
  setRolePreview,
  type AccountResponse,
} from "../../lib/api";

type Boot = "loading" | "login" | "ready" | "failed";

interface StaffValue {
  boot: Boot;
  user: { id: string; name: string } | null;
  guilds: GuildInfo[];
  guild: string;
  setGuild: (id: string) => void;
  guildName: string;
  demo: boolean;
  isAdmin: boolean;
  /** Effective role: the segment under test. Master outranks admin. */
  role: Role;
  isMaster: boolean;
  /** The real identity behind a preview. Only ever "master" when set. */
  realRole: Role;
  /** The segment under test, or null for the real view. Master only. */
  preview: "user" | "admin" | null;
  setPreview: (next: "user" | "admin" | null) => void;
  error: string;
  reference: string;
  retry: () => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<StaffValue | null>(null);

export function useStaff(): StaffValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useStaff must be used inside StaffProvider");
  return value;
}

export function StaffProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Boot>("loading");
  const [user, setUser] = useState<{ id: string; name: string } | null>(null);
  const [guilds, setGuilds] = useState<GuildInfo[]>([]);
  const [guild, setGuild] = useState("");
  const [demo, setDemo] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [role, setRole] = useState<Role>("user");
  const [isMaster, setIsMaster] = useState(false);
  const [realRole, setRealRole] = useState<Role>("user");
  const [preview, setPreviewState] = useState<"user" | "admin" | null>(null);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");

  const initialize = useCallback(async () => {
    setBoot("loading");
    setError("");
    setReference("");
    try {
      const me = await api<
        AccountResponse & {
          demo?: boolean;
          isAdmin?: boolean;
          isMaster?: boolean;
          role?: Role;
          realRole?: Role;
          preview?: "user" | "admin" | null;
        }
      >("/api/auth/me");
      setUser(me.user);
      setDemo(me.demo === true);
      setIsAdmin(me.isAdmin === true);
      setRole(me.role ?? (me.isAdmin === true ? "admin" : "user"));
      setIsMaster(me.isMaster === true || me.role === "master");
      setRealRole(me.realRole ?? me.role ?? "user");
      setPreviewState(me.preview ?? getRolePreview());
      const list = await api<{ guilds: GuildInfo[] }>("/api/guilds");
      setGuilds(list.guilds);
      const requested =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("server")
          : null;
      const stored =
        typeof window !== "undefined" ? window.sessionStorage.getItem("sf-server") : null;
      const initial =
        list.guilds.find((g) => g.guildId === (requested ?? stored))?.guildId ??
        list.guilds[0]?.guildId ??
        "";
      setGuild(initial);
      setBoot("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setBoot("login");
      else {
        setError(
          err instanceof Error && err.name !== "TimeoutError"
            ? err.message
            : "The request timed out. Please retry.",
        );
        setReference(err instanceof ApiError ? (err.correlationId ?? "") : "");
        setBoot("failed");
      }
    }
  }, []);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const selectGuild = useCallback((id: string) => {
    setGuild(id);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("sf-server", id);
      const url = new URL(window.location.href);
      url.searchParams.set("server", id);
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  const logout = useCallback(async () => {    const token = await api<{ csrfToken: string }>("/api/auth/csrf");
    await api("/api/auth/logout", {
      method: "POST",
      headers: { "x-csrf-token": token.csrfToken },
    });
    setBoot("login");
    setUser(null);
    setGuilds([]);
    setGuild("");
  }, []);

  const setPreview = useCallback(
    (next: "user" | "admin" | null) => {
      setRolePreview(next);
      setPreviewState(next);
      void initialize();
    },
    [initialize],
  );

  const value = useMemo<StaffValue>(
    () => ({
      boot,
      user,
      guilds,
      guild,
      setGuild: selectGuild,
      guildName: guilds.find((g) => g.guildId === guild)?.name ?? "",
      demo,
      isAdmin,
      role,
      isMaster,
      realRole,
      preview,
      setPreview,
      error,
      reference,
      retry: () => void initialize(),
      logout,
    }),
    [boot, user, guilds, guild, selectGuild, demo, isAdmin, role, isMaster, realRole, preview, setPreview, error, reference, initialize, logout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
