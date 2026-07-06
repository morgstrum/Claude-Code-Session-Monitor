import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type { SessionsSnapshot } from '../shared/types'

export interface SessionMonitorApi {
  getSessions: () => Promise<SessionsSnapshot>
  onSessionsUpdated: (cb: (snap: SessionsSnapshot) => void) => () => void
  setCompactMode: (compact: boolean) => void
  setAlwaysOnTop: (onTop: boolean) => void
  setCompactHeight: (height: number) => void
  setTheme: (theme: 'auto' | 'light' | 'dark') => void
}

const api: SessionMonitorApi = {
  getSessions: () => ipcRenderer.invoke(IPC.getSessions),
  onSessionsUpdated: (cb) => {
    const handler = (_event: unknown, snap: SessionsSnapshot): void => cb(snap)
    ipcRenderer.on(IPC.sessionsUpdated, handler)
    return () => ipcRenderer.removeListener(IPC.sessionsUpdated, handler)
  },
  setCompactMode: (compact) => ipcRenderer.send(IPC.setCompactMode, compact),
  setAlwaysOnTop: (onTop) => ipcRenderer.send(IPC.setAlwaysOnTop, onTop),
  setCompactHeight: (height) => ipcRenderer.send(IPC.setCompactHeight, height),
  setTheme: (theme) => ipcRenderer.send(IPC.setTheme, theme)
}

contextBridge.exposeInMainWorld('sessionMonitor', api)
