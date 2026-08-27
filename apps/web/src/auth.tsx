import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type User } from './api';
import { nscCacheBindUser, nscCacheClear } from './lib/nscCache';
import { nscFollowupsBindUser, nscFollowupsClearUser } from './lib/nscFollowups';

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (username: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const { user } = await api.session();
      nscCacheBindUser(user?.username);
      nscFollowupsBindUser(user?.username);
      setUser(user);
    } catch {
      nscCacheClear();
      nscFollowupsClearUser();
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const login = async (username: string, pin: string) => {
    const { user } = await api.login(username, pin);
    nscCacheBindUser(user?.username);
    nscFollowupsBindUser(user?.username);
    setUser(user);
  };

  const logout = async () => {
    await api.logout();
    nscCacheClear();
    nscFollowupsClearUser();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}
