export type ThemeChoice = 'auto' | 'light' | 'dark'

export interface AppSettings {
  viewMode: 'full' | 'compact'
  compactCount: number
  alwaysOnTop: boolean
  theme: ThemeChoice
}

const KEY = 'ccsm-settings'

export const COMPACT_COUNT_CHOICES = [3, 5, 8, 10, 15]

const DEFAULTS: AppSettings = {
  viewMode: 'full',
  compactCount: 5,
  alwaysOnTop: false,
  theme: 'auto'
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      viewMode: parsed.viewMode === 'compact' ? 'compact' : 'full',
      compactCount: COMPACT_COUNT_CHOICES.includes(parsed.compactCount as number)
        ? (parsed.compactCount as number)
        : DEFAULTS.compactCount,
      alwaysOnTop: parsed.alwaysOnTop === true,
      theme: parsed.theme === 'light' || parsed.theme === 'dark' ? parsed.theme : 'auto'
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(s: AppSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // localStorage unavailable — settings just won't persist
  }
}
