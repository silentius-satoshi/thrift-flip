// src/contexts/UserContext.jsx
// User context stub for future auth integration.
// Currently returns a single hardcoded local user.
// When Supabase auth is added, replace the provider implementation here only.

import { createContext, useContext, useState } from 'react';

const UserContext = createContext(null);

export function UserProvider({ children }) {
  const [user] = useState({
    id: 'local-user-001',
    name: 'Dad',
    email: null,
    plan: 'unlimited',        // 'free' | 'starter' | 'pro' | 'power' | 'unlimited'
    listingsThisMonth: 0,     // tracked against plan limit later
    analysesThisMonth: 0,     // tracked against plan limit later
    isAuthenticated: false,   // false until real auth added
    createdAt: null,
  });

  return (
    <UserContext.Provider value={{ user }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used within a UserProvider');
  return ctx;
}
