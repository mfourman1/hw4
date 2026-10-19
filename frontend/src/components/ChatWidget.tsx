import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { formatPrice, type User } from '../api.ts'
import { useAuth } from '../auth.ts'
import { OPEN_CHAT_EVENT } from '../categories.ts'
import {
  chatResultsUrl,
  currentPage,
  fetchChatHistory,
  guestHistory,
  removedNotice,
  sendChatMessage,
  type ChatMessage,
  type ChatProductCard,
} from '../chat.ts'
import FadeImage from './FadeImage.tsx'

// A caricature of Handsome Dan, Yale's bulldog: an original drawing (public/handsome-dan.svg)
// with his white face, underbite, navy sweater, and blue bow tie.
const BULLDOG = '/handsome-dan.svg'
const CLOSE_MS = 220 // matches the panel's fade-out in index.css

// Every conversation opens with "Boola Boola!" as the first words of the greeting. It is said
// once, at the start: the agent is told never to repeat it later in the chat (prompt.md).

function greeting(user: User | null, hasHistory: boolean): ChatMessage {
  const content = !user
    ? "Hi! I'm the Campus Customs shop assistant. Ask me about products, sizes, or prices. " +
      'Log in and I will remember our chat next time.'
    : hasHistory
      ? `Welcome back, ${user.first_name}! Our earlier chat is above. What can I help you find today?`
      : `Hi ${user.first_name}! I'm the Campus Customs shop assistant. Ask me about products, sizes, or prices.`
  return { role: 'assistant', content: `Boola Boola! ${content}`, notHistory: true }
}

function ChatCard({ product }: { product: ChatProductCard }) {
  const location = useLocation()
  return (
    <Link
      to={`/products/${product.product_id}`}
      state={{ from: location.pathname + location.search }}
      className="chat-card"
    >
      <FadeImage src={product.image_url} alt="" />
      <span className="chat-card-name">{product.name}</span>
      <span className="chat-card-price">{formatPrice(product.price)}</span>
    </Link>
  )
}

export default function ChatWidget() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false) // stays true while the panel fades out
  const [messages, setMessages] = useState<ChatMessage[]>(() => [greeting(null, false)])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function show() {
    setMounted(true)
    setOpen(true)
  }

  function hide() {
    setOpen(false)
    window.setTimeout(() => setMounted(false), CLOSE_MS)
  }

  // "Chat with us" links elsewhere on the site open the panel.
  useEffect(() => {
    window.addEventListener(OPEN_CHAT_EVENT, show)
    return () => window.removeEventListener(OPEN_CHAT_EVENT, show)
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true })
  }, [open])

  // Whenever who is logged in changes: a logged-in shopper gets their saved chat back; on
  // logout (or as a guest) the panel starts fresh, so the next person can't see it.
  const userId = user?.id
  useEffect(() => {
    if (!user) {
      setMessages([greeting(null, false)])
      return
    }
    let cancelled = false
    setLoadingHistory(true)
    fetchChatHistory()
      .then((saved) => {
        if (!cancelled) setMessages([...saved, greeting(user, saved.length > 0)])
      })
      .catch(() => {
        if (!cancelled) setMessages([greeting(user, false)])
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the account changes
  }, [userId])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, open, sending])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || sending) return

    // Guests send their conversation so far; logged-in shoppers' history comes from the database.
    const history = user ? [] : guestHistory(messages)
    setMessages((current) => [...current, { role: 'user', content: text }])
    setDraft('')
    setSending(true)
    try {
      const reply = await sendChatMessage(text, currentPage(location.pathname), history)
      let message: ChatMessage = { role: 'assistant', content: reply.reply }
      if (reply.filtered || reply.withheld) {
        message = { ...message, notHistory: true }
      } else if (reply.show_on_page && reply.products.length > 0) {
        // Browsing search: put the matching products on the page as cards.
        const url = chatResultsUrl(
          reply.results_title ?? 'Chat results',
          reply.products.map((p) => p.product_id),
        )
        message = { ...message, resultsUrl: url }
        navigate(url)
      } else if (reply.products.length > 0) {
        message = { ...message, products: reply.products }
      }
      setMessages((current) => {
        const last = current.length - 1
        const updated = current.map((m, i) => {
          if (i !== last) return m
          // Show the shopper's message the way it was saved: sensitive details removed.
          let shown: ChatMessage = { ...m, content: reply.your_message ?? m.content, notice: removedNotice(reply.removed) }
          // A blocked message is kept out of the history too, so it can't trip the filter again.
          if (reply.filtered || reply.withheld) shown = { ...shown, notHistory: true }
          return shown
        })
        return [...updated, message]
      })
    } catch (err) {
      const content =
        err instanceof Error && err.message
          ? err.message
          : "Sorry, I couldn't reach the shop right now. Please try again."
      setMessages((current) => [...current, { role: 'assistant', content, notHistory: true }])
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="chat">
      {mounted && (
        <section className={`chat-panel${open ? ' is-open' : ' is-closing'}`} aria-label="Shop assistant chat">
          {/* Handsome Dan pops up over the panel every time it opens. */}
          <img className="chat-dog" src={BULLDOG} alt="Handsome Dan, Yale's bulldog" />
          <header className="chat-header">
            <div>
              <strong>Handsome Dan</strong>
              <span>Campus Customs shop assistant</span>
            </div>
            <button type="button" className="chat-close" onClick={hide} aria-label="Close chat">
              ×
            </button>
          </header>
          <div className="chat-messages" ref={listRef}>
            {loadingHistory && (
              <div className="chat-turn assistant">
                <img className="chat-avatar" src={BULLDOG} alt="" />
                <p className="chat-message assistant typing" aria-label="Loading your chat">
                  <span />
                  <span />
                  <span />
                </p>
              </div>
            )}
            {messages.map((message, i) => (
              <div key={i} className={`chat-turn ${message.role}`}>
                {message.role === 'assistant' && <img className="chat-avatar" src={BULLDOG} alt="" />}
                <div className="chat-turn-body">
                  <p className={`chat-message ${message.role}`}>{message.content}</p>
                  {message.notice && <p className="chat-notice">🔒 {message.notice}</p>}
                  {message.products && (
                    <div className="chat-cards">
                      {message.products.map((p) => (
                        <ChatCard key={p.product_id} product={p} />
                      ))}
                    </div>
                  )}
                  {message.resultsUrl && (
                    <Link to={message.resultsUrl} className="chat-results-link">
                      Show these results on the page
                    </Link>
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div className="chat-turn assistant">
                <img className="chat-avatar" src={BULLDOG} alt="" />
                <p className="chat-message assistant typing" aria-label="Handsome Dan is typing">
                  <span />
                  <span />
                  <span />
                </p>
              </div>
            )}
          </div>
          <form className="chat-input" onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask Handsome Dan about a product…"
              aria-label="Chat message"
            />
            <button type="submit" className="button" disabled={sending || !draft.trim()}>
              Send
            </button>
          </form>
        </section>
      )}
      {!open && (
        <button type="button" className="chat-tab" onClick={show} aria-expanded={false} aria-label="Open chat">
          <img className="chat-tab-dog" src={BULLDOG} alt="" />
          <span className="chat-tab-dot" aria-hidden="true" />
          Chat with us
        </button>
      )}
    </div>
  )
}
