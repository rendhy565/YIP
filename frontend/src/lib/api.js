import axios from "axios";

// Empty / undefined → pakai relative URL (frontend & backend di domain sama via nginx proxy)
const RAW = process.env.REACT_APP_BACKEND_URL;
const BASE = RAW && RAW !== "undefined" ? RAW : "";

const api = axios.create({
  baseURL: `${BASE}/api`,
  timeout: 0,
});

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("tms_token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      // Do NOT hijack login attempts — let the login form surface the error itself.
      const url = err.config?.url || "";
      const isLoginRequest = /\/auth\/login\b/.test(url);
      if (!isLoginRequest) {
        localStorage.removeItem("tms_token");
        localStorage.removeItem("tms_user");
        const loginPath = (process.env.PUBLIC_URL || "") + "/login";
        // Handle app served under a sub-path (e.g. /arc) — check exact loginPath.
        if (window.location.pathname !== loginPath) {
          window.location.href = loginPath;
        }
      }
    }
    return Promise.reject(err);
  }
);

export default api;
export const BACKEND_URL = BASE;
