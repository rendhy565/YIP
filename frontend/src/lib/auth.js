import React, { createContext, useContext, useEffect, useState } from "react";
import api from "./api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const s = localStorage.getItem("tms_user");
    return s ? JSON.parse(s) : null;
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("tms_token");
    if (token) {
      setLoading(true);
      api.get("/auth/me")
        .then((r) => {
          setUser(r.data);
          localStorage.setItem("tms_user", JSON.stringify(r.data));
        })
        .catch(() => {
          localStorage.removeItem("tms_token");
          localStorage.removeItem("tms_user");
          setUser(null);
        })
        .finally(() => setLoading(false));
    }
  }, []); // eslint-disable-line

  const login = async (username, password) => {
    const r = await api.post("/auth/login", { username, password });
    localStorage.setItem("tms_token", r.data.access_token);
    localStorage.setItem("tms_user", JSON.stringify(r.data.user));
    setUser(r.data.user);
    return r.data.user;
  };

  const logout = () => {
    localStorage.removeItem("tms_token");
    localStorage.removeItem("tms_user");
    setUser(null);
    window.location.href = (process.env.PUBLIC_URL || "") + "/login";
  };

  return (
    <AuthCtx.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
