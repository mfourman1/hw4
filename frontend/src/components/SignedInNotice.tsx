import { Link } from 'react-router-dom'
import { useAuth } from '../auth.ts'

// Shown on Log in / Create account when someone is already signed in.
export default function SignedInNotice({ title }: { title: string }) {
  const { user, logout } = useAuth()
  if (!user) return null

  return (
    <section className="page form-page">
      <h1>{title}</h1>
      <p>
        You're signed in as{' '}
        <strong>
          {user.first_name} {user.last_name}
        </strong>{' '}
        ({user.email}).
      </p>
      <p>
        <Link to="/products">Keep shopping</Link> or{' '}
        <button type="button" className="link-button" onClick={logout}>
          log out
        </button>
        .
      </p>
    </section>
  )
}
