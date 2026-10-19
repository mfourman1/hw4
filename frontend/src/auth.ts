import { createContext, useContext } from 'react'
import type { SignupDetails, User } from './api.ts'

// Who is signed in, shared with every page through <AuthProvider>.

export type AuthState = {
  user: User | null
  login: (email: string, password: string) => Promise<User>
  signup: (details: SignupDetails) => Promise<User>
  logout: () => void
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>')
  return auth
}
