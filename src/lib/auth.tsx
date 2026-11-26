import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { usernameToEmail } from "./accounts";
import type { PlatformRole, Profile } from "./types";

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  platformRole: PlatformRole | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [platformRole, setPlatformRole] = useState<PlatformRole | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setPlatformRole(null);
      return;
    }
    const [{ data: p }, { data: pa }] = await Promise.all([
      supabase.from("profiles").select("id, username, full_name, phone, must_change_password, is_disabled").eq("id", s.user.id).maybeSingle(),
      supabase.from("platform_admins").select("role").eq("user_id", s.user.id).maybeSingle(),
    ]);
    setProfile((p as Profile | null) ?? null);
    setPlatformRole((pa?.role as PlatformRole | undefined) ?? null);
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadProfile(data.session);
      if (active) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        // Evita llamadas a Supabase dentro del callback (recomendación del SDK).
        setTimeout(() => void loadProfile(s), 0);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (username: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("invalid login")) throw new Error("Usuario o contraseña incorrectos.");
      if (msg.includes("banned")) throw new Error("Tu cuenta está bloqueada. Contacta a soporte.");
      throw new Error("No se pudo iniciar sesión. Inténtalo de nuevo.");
    }
    setSession(data.session);
    await loadProfile(data.session);
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    qc.clear();
    setSession(null);
    setProfile(null);
    setPlatformRole(null);
  }, [qc]);

  const refreshProfile = useCallback(() => loadProfile(session), [loadProfile, session]);

  const value = useMemo(
    () => ({ loading, session, profile, platformRole, signIn, signOut, refreshProfile }),
    [loading, session, profile, platformRole, signIn, signOut, refreshProfile],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}
