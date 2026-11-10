import { useI18n } from '../../i18n/useI18n'
import type { ScreenState } from './journeySteps'

/** Countdowns and codes on the device: not words, never translated. */
/** Under the 60 s challenge lifetime (doc 09 §15.5, ADR-009); the 120 s window starts at local authorization. */
const QR_COUNTDOWN = '00:52'
const OPEN_COUNTDOWN = '01:21'
const COMPARTMENTS = 'A1 · A2'

/**
 * A 21 × 21 pattern with the three finder squares of a QR code and pseudo-random modules. It encodes
 * nothing and cannot be scanned: the hub screen is an illustration (handoff §4.3).
 */
function qrModules(): string {
  const size = 21
  const cells: string[] = []
  const finder = (left: number, top: number) => {
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 7; c++) {
        const ring = r === 0 || r === 6 || c === 0 || c === 6
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4
        if (ring || core) cells.push(`M${left + c} ${top + r}h1v1h-1z`)
      }
  }
  finder(0, 0)
  finder(14, 0)
  finder(0, 14)
  let seed = 7
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) {
      const inFinder = (r < 8 && c < 8) || (r < 8 && c > 12) || (r > 12 && c < 8)
      if (inFinder) continue
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      if ((seed >> 16) % 100 < 46) cells.push(`M${c} ${r}h1v1h-1z`)
    }
  return cells.join('')
}

const QR_PATH = qrModules()

/** The hub's own screen, in its 300 × 200 design space. It is a device: it does not follow the theme. */
export function HubScreen({ state }: { readonly state: ScreenState }) {
  const { m } = useI18n()
  const s = m.landing.screen
  const top = (over: string) => (
    <div className="lp-screen__top">
      <span className="lp-screen__word">aegis</span>
      <span>{over}</span>
    </div>
  )
  const foot = (left: string, right = 'A1') => (
    <div className="lp-screen__foot">
      <span>{left}</span>
      <span>{right}</span>
    </div>
  )
  switch (state) {
    case 'idle':
      return (
        <div className={`lp-screen lp-screen--${state}`} aria-hidden="true">
          {top(s.idle.over)}
          <div className="lp-screen__body">
            <p className="lp-screen__title">{COMPARTMENTS}</p>
            <p className="lp-screen__text">{s.idle.text}</p>
          </div>
          {foot(s.idle.foot, '')}
        </div>
      )
    case 'qr':
      return (
        <div className={`lp-screen lp-screen--${state}`} aria-hidden="true">
          {top(s.qr.over)}
          <div className="lp-screen__body">
            <div className="lp-screen__qr">
              <svg viewBox="0 0 21 21" shapeRendering="crispEdges">
                <path d={QR_PATH} />
              </svg>
            </div>
            <div>
              <p className="lp-screen__title">{s.qr.title}</p>
              <p className="lp-screen__text">{s.qr.text}</p>
            </div>
          </div>
          {foot(QR_COUNTDOWN)}
        </div>
      )
    case 'verify':
      return (
        <div className={`lp-screen lp-screen--${state}`} aria-hidden="true">
          {top(s.verify.over)}
          <div className="lp-screen__body">
            <p className="lp-screen__title">{s.verify.title}</p>
            <p className="lp-screen__text">{s.verify.text}</p>
            <div className="lp-screen__bar">
              <i />
            </div>
          </div>
          {foot(s.verify.foot)}
        </div>
      )
    case 'open':
      return (
        <div className={`lp-screen lp-screen--${state}`} aria-hidden="true">
          {top(s.open.over)}
          <div className="lp-screen__body">
            <p className="lp-screen__title">{s.open.title}</p>
            <p className="lp-screen__text">{s.open.text}</p>
          </div>
          {foot(OPEN_COUNTDOWN)}
        </div>
      )
    case 'confirmed':
    case 'result':
      return (
        <div className={`lp-screen lp-screen--${state}`} aria-hidden="true">
          {top(s[state].over)}
          <div className="lp-screen__body">
            <p className="lp-screen__title lp-screen__ok">
              {state === 'confirmed' && <span className="lp-screen__dot" />}
              {s[state].title}
            </p>
            <p className="lp-screen__text">{s[state].text}</p>
          </div>
          {foot(s[state].foot)}
        </div>
      )
  }
}
