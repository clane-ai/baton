// STAGING STUB — not copied to the platform. Behaves like clane-client/src/lib/auth.tsx:
// useAuth() throws outside AuthProvider; useAuthOptional() returns null there. The provider
// here supplies a fixed signed-in user for specs that want one.
import React, { createContext, useContext } from 'react';

export type AuthUser = { id: string; name?: string; username?: string; email?: string };
export type AuthContextShape = { user: AuthUser | null; logout: () => Promise<void> };

const AuthCtx = createContext<AuthContextShape | null>(null);

const SIGNED_IN: AuthContextShape = {
  user: { id: 'user-1', name: 'Abhishek Jha', email: 'abhishek@example.com' },
  logout: async () => {},
};

export function AuthProvider({ children, value = SIGNED_IN }: { children?: React.ReactNode; value?: AuthContextShape }): JSX.Element {
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthContextShape {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function useAuthOptional(): AuthContextShape | null {
  return useContext(AuthCtx);
}
