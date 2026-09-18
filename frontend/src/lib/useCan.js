// Permission helper hook — reads from current user (auth context / localStorage)
// Usage:
//   const canReceive = useCan("orders_list", "receive");
//   if (!canReceive) return null; // hide button
//
// Behavior:
// - Returns true ONLY if user.permission_actions[module][feature] === true.
// - No role-based bypass. Administrator must also be configured (auto-seeded on first login).
// - If permission_actions is empty/missing entirely → treat as no permissions (safe default).
import { useAuth } from "./auth";

export function useCan(moduleKey, featureKey) {
  const { user } = useAuth();
  if (!user || !user.permission_actions) return false;
  const mod = user.permission_actions[moduleKey];
  if (!mod) return false;
  return !!mod[featureKey];
}

// Convenience: returns object of all features for a module → useful for batch render
export function useModulePerms(moduleKey) {
  const { user } = useAuth();
  if (!user || !user.permission_actions) return {};
  return user.permission_actions[moduleKey] || {};
}
