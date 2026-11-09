/** Hub screen states, in journey order (handoff §4.3). */
export type ScreenState = 'idle' | 'qr' | 'verify' | 'open' | 'confirmed' | 'result'
export type Doors = 'closed' | 'open-a1'
export type Light = 'off' | 'a1'

export const STEP_IDS = ['reserve', 'prepare', 'scan', 'open', 'prove', 'return'] as const
export type StepId = (typeof STEP_IDS)[number]

export interface StepView {
  readonly screen: ScreenState
  readonly doors: Doors
  readonly light: Light
  /** Only reservation exists today (claims C1, C2); the others stay « En conception » while C3 and C4 are planned. */
  readonly live: boolean
}

export const STEP_VIEWS: Readonly<Record<StepId, StepView>> = {
  reserve: { screen: 'idle', doors: 'closed', light: 'off', live: true },
  prepare: { screen: 'qr', doors: 'closed', light: 'off', live: false },
  scan: { screen: 'verify', doors: 'closed', light: 'off', live: false },
  open: { screen: 'open', doors: 'open-a1', light: 'off', live: false },
  prove: { screen: 'confirmed', doors: 'closed', light: 'a1', live: false },
  return: { screen: 'result', doors: 'closed', light: 'off', live: false },
}

export function stepNumber(index: number): string {
  return String(index + 1).padStart(2, '0')
}
