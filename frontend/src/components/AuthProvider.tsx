import { useEffect, useState, type ReactNode } from 'react'
import * as api from '../api.ts'
import { AuthContext, type AuthState } from '../auth.ts'

// The real login lives in an HttpOnly session cookie set by the backend. The public profile
// (id, name, email) is also kept in localStorage so the nav can show "Hi, Name" right away
// after a refresh; it is then checked against the server, and cleared if the session is gone.
// The password is never stored.

const STORAGE_KEY = 'campus-customs-user'

function loadUser(): api.User | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
  } catch {
    return null
  }
}

function remember(user: api.User | null) {
  if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
  else localStorage.removeItem(STORAGE_KEY)
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<api.User | null>(loadUser)

  useEffect(() => {
    let cancelled = false
    api
      .fetchMe()
      .then((me) => {
        if (cancelled) return
        remember(me)
        setUser(me)
      })
      .catch(() => {}) // backend unreachable: keep what we have until it's back
    return () => {
      cancelled = true
    }
  }, [])

  function signIn(next: api.User) {
    remember(next)
    setUser(next)
    return next
  }

  const value: AuthState = {
    user,
    login: async (email, password) => signIn(await api.login(email, password)),
    signup: async (details) => signIn(await api.signup(details)),
    logout: () => {
      remember(null)
      setUser(null)
      api.logout().catch(() => {})
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
