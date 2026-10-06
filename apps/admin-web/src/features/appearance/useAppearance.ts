import { createContext, useContext, useSyncExternalStore } from 'react'
import type { AppearanceController, AppearanceSnapshot } from './appearance'

export const AppearanceContext = createContext<AppearanceController | null>(null)

export function useAppearance(): AppearanceSnapshot & { setPreference: AppearanceController['setPreference'] } {
  const controller = useContext(AppearanceContext)
  if (!controller) throw new Error('useAppearance requires an AppearanceContext provider')
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  return { ...snapshot, setPreference: controller.setPreference }
}
