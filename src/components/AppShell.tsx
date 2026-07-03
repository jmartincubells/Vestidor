import { Outlet, NavLink } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'

interface AppShellProps {
  user: User
}

export default function AppShell({ user: _user }: AppShellProps) {
  return (
    <div className="page" style={{ paddingBottom: 72 }}>
      <Outlet />

      <nav className="bottom-nav">
        <NavLink to="/vestidor" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          {({ isActive }) => (
            <>
              <svg viewBox="0 0 24 24" fill={isActive ? 'currentColor' : 'none'} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3a3 3 0 0 1 3 3 3 3 0 0 1-3 3 3 3 0 0 1-3-3 3 3 0 0 1 3-3m0 8c-4 0-6 2-6 4v1h12v-1c0-2-2-4-6-4z" />
              </svg>
              <span>Vestidor</span>
            </>
          )}
        </NavLink>

        <NavLink to="/agregar" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          {() => (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" d="M12 8v8M8 12h8" />
              </svg>
              <span>Agregar</span>
            </>
          )}
        </NavLink>

        <NavLink to="/closet" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          {({ isActive }) => (
            <>
              <svg viewBox="0 0 24 24" fill={isActive ? 'none' : 'none'} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 3h12l1 3-7 4-7-4 1-3z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 6v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 11h4" />
              </svg>
              <span>Closet</span>
            </>
          )}
        </NavLink>

        <NavLink to="/perfil" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          {({ isActive }) => (
            <>
              <svg viewBox="0 0 24 24" fill={isActive ? 'currentColor' : 'none'} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span>Perfil</span>
            </>
          )}
        </NavLink>
      </nav>
    </div>
  )
}
