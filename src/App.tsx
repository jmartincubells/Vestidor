import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import type { User } from '@supabase/supabase-js'
import AuthPage from './pages/AuthPage'
import OnboardingPage from './pages/OnboardingPage'
import WardrobePage from './pages/WardrobePage'
import ClosetPage from './pages/ClosetPage'
import AddGarmentPage from './pages/AddGarmentPage'
import AppShell from './components/AppShell'
import { ToastProvider } from './components/ui/Toast'

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false)

  useEffect(() => {
    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Listen to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    // Check if user has completed onboarding (has mannequin measurements)
    if (!user) return
    supabase
      .from('maniqui')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setHasCompletedOnboarding(!!data))
  }, [user])

  if (loading) {
    return (
      <div className="page-centered">
        <div className="spinner spinner-lg" />
      </div>
    )
  }

  if (!user) {
    return (
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="*" element={<AuthPage />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    )
  }

  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          {!hasCompletedOnboarding ? (
            <>
              <Route
                path="/onboarding"
                element={
                  <OnboardingPage
                    user={user}
                    onComplete={() => setHasCompletedOnboarding(true)}
                  />
                }
              />
              <Route path="*" element={<Navigate to="/onboarding" replace />} />
            </>
          ) : (
            <Route element={<AppShell user={user} />}>
              <Route index element={<Navigate to="/vestidor" replace />} />
              <Route path="/vestidor" element={<WardrobePage user={user} />} />
              <Route path="/closet" element={<ClosetPage user={user} />} />
              <Route path="/agregar" element={<AddGarmentPage user={user} />} />
              <Route path="*" element={<Navigate to="/vestidor" replace />} />
            </Route>
          )}
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  )
}

export default App
