import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/ui/Toast'

export default function AuthPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<'idle' | 'sent'>('idle')
  const { showToast } = useToast()

  // Handle OAuth redirect callback
  useEffect(() => {
    supabase.auth.getSession()
  }, [])

  async function handleGoogleLogin() {
    setLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    })
    if (error) {
      showToast('Error al iniciar sesión con Google', 'error')
      setLoading(false)
    }
    // If no error, browser redirects to Google — setLoading stays true intentionally
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    setLoading(false)
    if (error) {
      showToast('No se pudo enviar el link. Revisá el email.', 'error')
    } else {
      setStep('sent')
    }
  }

  return (
    <div className="page-centered" style={{ gap: 'var(--space-xl)' }}>
      {/* Logo / branding */}
      <div className="flex flex-col items-center gap-md animate-fade-in">
        <div style={{
          width: 80, height: 80,
          borderRadius: 'var(--radius-xl)',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-glow)',
          border: '1px solid var(--clr-border)',
        }}>
          <img src="/icon-512.png" alt="Vestidor" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
        <div className="text-center">
          <h1 className="font-display text-2xl font-semibold text-primary tracking-wide">
            Vestidor
          </h1>
          <p className="text-sm text-muted" style={{ marginTop: 4 }}>
            Tu placard virtual personal
          </p>
        </div>
      </div>

      {step === 'sent' ? (
        <div className="glass animate-fade-in-scale text-center" style={{ padding: 'var(--space-xl)', maxWidth: 360, width: '100%' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 'var(--space-md)' }}>✉️</div>
          <h2 className="font-display text-xl font-semibold" style={{ marginBottom: 'var(--space-sm)' }}>
            Revisá tu email
          </h2>
          <p className="text-sm text-muted">
            Te mandamos un link mágico a <strong className="text-primary">{email}</strong>.
            Tocalo para entrar.
          </p>
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 'var(--space-lg)' }}
            onClick={() => setStep('idle')}
          >
            Usar otro email
          </button>
        </div>
      ) : (
        <div
          className="glass animate-fade-in-scale flex flex-col gap-lg"
          style={{ padding: 'var(--space-xl)', maxWidth: 360, width: '100%' }}
        >
          {/* Google OAuth */}
          <button
            id="btn-google-login"
            className="btn btn-secondary w-full"
            onClick={handleGoogleLogin}
            disabled={loading}
            style={{ gap: 'var(--space-sm)', padding: '14px 24px' }}
          >
            {loading ? (
              <div className="spinner" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
            )}
            Continuar con Google
          </button>

          <div className="divider">o</div>

          {/* Magic link fallback */}
          <form onSubmit={handleMagicLink} className="flex flex-col gap-sm">
            <input
              id="input-email"
              type="email"
              placeholder="tu@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="input"
              autoComplete="email"
              inputMode="email"
              required
            />
            <button
              id="btn-magic-link"
              type="submit"
              className="btn btn-primary w-full"
              disabled={loading || !email}
            >
              {loading ? <div className="spinner" /> : 'Entrar con link mágico'}
            </button>
          </form>

          <p className="text-xs text-dimmed text-center" style={{ lineHeight: 1.5 }}>
            Esta app es solo tuya. No compartimos tus datos con nadie.
          </p>
        </div>
      )}
    </div>
  )
}
