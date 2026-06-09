import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "./api";
import { useAuth } from "./auth";

const FFCtx = createContext({ flags: {}, loading: true, refresh: () => {} });

export function FeatureFlagsProvider({ children }) {
  const { user } = useAuth();
  const [flags, setFlags] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setFlags({});
      setLoading(false);
      setLoadedOnce(true);
      return;
    }
    setLoading(true);
    try {
      const r = await api.get("/feature-flags");
      const obj = {};
      r.data.forEach((f) => { obj[f.key] = f.enabled; });
      setFlags(obj);
    } catch {
      setFlags({ accounting: true });
    } finally {
      setLoading(false);
      setLoadedOnce(true);
    }
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <FFCtx.Provider value={{ flags, loading: loading || !loadedOnce, refresh }}>
      {children}
    </FFCtx.Provider>
  );
}

export const useFeatureFlags = () => useContext(FFCtx);
export const useFeature = (key) => {
  const { flags } = useContext(FFCtx);
  return !!flags[key];
};
