// STAGING STUB — not copied to the platform. Same shape as clane-client/src/lib/auth.tsx.
import React, { createContext, useContext } from "react";

export type AuthUser = { id: string; name?: string; username?: string; email?: string };
export type AuthContextShape = { user: AuthUser | null; logout: () => Promise<void> };

const Ctx = createContext<AuthContextShape>({ user: { id: "user-1", name: "Abhishek Jha", email: "abhishek@example.com" }, logout: async () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }): JSX.Element {
  return <Ctx.Provider value={useContext(Ctx)}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthContextShape {
  return useContext(Ctx);
}

export function useAuthOptional(): AuthContextShape | null {
  return useContext(Ctx);
}
