import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth.ts'
import SignedInNotice from '../components/SignedInNotice.tsx'

const MIN_PASSWORD = 8

export default function CreateAccount() {
  const { user, signup } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const field = (name: string) => String(form.get(name) ?? '')

    if (field('password') !== field('confirm_password')) {
      setError("Passwords don't match.")
      return
    }

    setError('')
    setSubmitting(true)
    try {
      await signup({
        first_name: field('first_name'),
        last_name: field('last_name'),
        email: field('email'),
        password: field('password'),
      })
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed. Please try again.')
      setSubmitting(false)
    }
  }

  if (user) return <SignedInNotice title="Create account" />

  return (
    <section className="page form-page">
      <h1>Create account</h1>
      <form className="form" onSubmit={handleSubmit}>
        <div className="form-row">
          <label>
            First name
            <input name="first_name" autoComplete="given-name" maxLength={50} required />
          </label>
          <label>
            Last name
            <input name="last_name" autoComplete="family-name" maxLength={50} required />
          </label>
        </div>
        <label>
          Email
          <input type="email" name="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            maxLength={128}
            required
          />
          <span className="hint">At least {MIN_PASSWORD} characters.</span>
        </label>
        <label>
          Confirm password
          <input type="password" name="confirm_password" autoComplete="new-password" required />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="muted">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </section>
  )
}
