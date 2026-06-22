"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { authApi, watchApi, getToken, setToken, AuthUser, Watch, AlertItem } from "@/lib/auth";
import { toast } from "@/hooks/use-toast";

export interface WatchTarget {
  groupKey: string;
  displayName?: string;
  thumbnail?: string;
  price?: number;
  vendor?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  // auth
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  googleSignIn: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
  requestMagicLink: (email: string) => Promise<void>;
  consumeMagicToken: (token: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  confirmPasswordReset: (token: string, newPassword: string) => Promise<void>;
  updateProfile: (name: string, email: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  // watchlist
  watches: Watch[];
  isWatched: (groupKey: string) => boolean;
  toggleWatch: (t: WatchTarget) => Promise<void>;
  setTarget: (groupKey: string, targetPrice: number | null) => Promise<void>;
  alerts: AlertItem[];
  refreshAlerts: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);

  const loadWatches = useCallback(async () => {
    try {
      const { watches } = await watchApi.list();
      setWatches(watches || []);
    } catch {
      setWatches([]);
    }
  }, []);

  const applySession = useCallback(
    async (token: string, u: AuthUser) => {
      setToken(token);
      setUser(u);
      await loadWatches();
    },
    [loadWatches]
  );

  // Restore session on mount.
  useEffect(() => {
    (async () => {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const { user } = await authApi.me();
        setUser(user);
        await loadWatches();
      } catch {
        setToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadWatches]);

  const login = async (email: string, password: string) => {
    const { token, user } = await authApi.login(email, password);
    await applySession(token, user);
  };
  const register = async (email: string, name: string, password: string) => {
    const { token, user } = await authApi.register(email, name, password);
    await applySession(token, user);
  };
  const googleSignIn = async (credential: string) => {
    const { token, user } = await authApi.google(credential);
    await applySession(token, user);
  };
  const consumeMagicToken = async (mt: string) => {
    const { token, user } = await authApi.magicConsume(mt);
    await applySession(token, user);
  };
  const logout = async () => {
    try {
      await authApi.logout();
    } catch {
      /* ignore */
    }
    setToken(null);
    setUser(null);
    setWatches([]);
    setAlerts([]);
  };
  const requestMagicLink = async (email: string) => {
    await authApi.magicLink(email);
  };
  const requestPasswordReset = async (email: string) => {
    await authApi.passwordReset(email);
  };
  const confirmPasswordReset = async (token: string, newPassword: string) => {
    await authApi.passwordResetConfirm(token, newPassword);
  };
  const updateProfile = async (name: string, email: string) => {
    const { user } = await authApi.updateProfile(name, email);
    setUser(user);
  };
  const changePassword = async (cur: string, nw: string) => {
    await authApi.changePassword(cur, nw);
  };

  const isWatched = (groupKey: string) => watches.some((w) => w.group_key === groupKey);

  const toggleWatch = async (t: WatchTarget) => {
    if (!user) {
      toast({ title: "Prijavite se", description: "Prijavite se da pratite cene i dobijate obaveštenja." });
      return;
    }
    if (isWatched(t.groupKey)) {
      setWatches((prev) => prev.filter((w) => w.group_key !== t.groupKey));
      try {
        await watchApi.remove(t.groupKey);
      } catch {
        loadWatches();
      }
    } else {
      try {
        await watchApi.add({
          groupKey: t.groupKey,
          displayName: t.displayName,
          thumbnail: t.thumbnail,
          price: t.price,
          vendor: t.vendor,
        });
        await loadWatches();
        toast({ title: "Praćenje uključeno", description: "Obavestićemo vas kada cena padne." });
      } catch {
        toast({ title: "Greška", description: "Nije moguće sačuvati praćenje." });
      }
    }
  };

  const setTarget = async (groupKey: string, targetPrice: number | null) => {
    await watchApi.setTarget(groupKey, targetPrice);
    setWatches((prev) => prev.map((w) => (w.group_key === groupKey ? { ...w, target_price: targetPrice } : w)));
  };

  const refreshAlerts = useCallback(async () => {
    if (!getToken()) return;
    try {
      const { alerts } = await watchApi.alerts();
      setAlerts(alerts || []);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user, loading, login, register, googleSignIn, logout,
        requestMagicLink, consumeMagicToken, requestPasswordReset, confirmPasswordReset,
        updateProfile, changePassword,
        watches, isWatched, toggleWatch, setTarget, alerts, refreshAlerts,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
