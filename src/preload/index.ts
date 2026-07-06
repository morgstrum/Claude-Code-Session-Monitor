import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type { SessionsSnapshot } from '../shared/types'

export interface SessionMonitorApi {
  getSessions: () => Promise<SessionsSnapshot>
  onSessionsUpdated: (cb: (snap: SessionsSnapshot) => void) => () => void
}

const api: SessionMonitorApi = {
  getSessions: () => ipcRenderer.invoke(IPC.getSessions),
  onSessionsUpdated: (cb) => {
    const handler = (_event: unknown, snap: SessionsSnapshot): void => cb(snap)
    ipcRenderer.on(IPC.sessionsUpdated, handler)
    return () => ipcRenderer.removeListener(IPC.sessionsUpdated, handler)
  }
}

contextBridge.exposeInMainWorld('sessionMonitor', api)
