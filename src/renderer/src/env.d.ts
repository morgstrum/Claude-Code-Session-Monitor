import type { SessionsSnapshot } from '@shared/types'

declare global {
  interface Window {
    sessionMonitor: {
      getSessions: () => Promise<SessionsSnapshot>
      onSessionsUpdated: (cb: (snap: SessionsSnapshot) => void) => () => void
      setCompactMode: (compact: boolean) => void
      setAlwaysOnTop: (onTop: boolean) => void
      setCompactHeight: (height: number) => void
      setTheme: (theme: 'auto' | 'light' | 'dark') => void
    }
  }
}

export {}
