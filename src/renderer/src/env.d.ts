import type { SessionsSnapshot } from '@shared/types'

declare global {
  interface Window {
    sessionMonitor: {
      getSessions: () => Promise<SessionsSnapshot>
      onSessionsUpdated: (cb: (snap: SessionsSnapshot) => void) => () => void
    }
  }
}

export {}
