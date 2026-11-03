import { useId, useLayoutEffect, useRef } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { ReadOnlyMark } from '../../ui/ReadOnlyMark'
import { StatusChip } from '../../ui/StatusChip'
import { classifyCatalogFailure } from '../catalog/catalogFailure'
import { StaleNotice } from '../catalog/StaleNotice'
import type { CompartmentStatus, LockerStatus } from './contract'
import { LockerAlert } from './LockerAlert'
import {
  asLastKnown,
  chipRole,
  connectionChip,
  connectionNote,
  doorState,
  enabledState,
  evaluatedTimeLabel,
  hasUnrecognizedValue,
  linkState,
  lockState,
  readerState,
  technicalInstantLabel,
  windowView,
  type StateView,
} from './lockerPresentation'
import { useLockerStatus } from './useLockerStatus'

/** A locker code that fits a phone line is never broken at its hyphens; a longer one may wrap rather than overflow. */
const MAX_UNBROKEN_CODE = 24

/**
 * Read-only status of one locker (PHY-01 #29, 09 §8.6, §16.1): connection, operating window and compartments,
 * exactly as the server evaluated them. There is no control here that changes a state, forces a readiness,
 * opens a compartment or sends a command: the Manager has no such route (09 §17, §25).
 */
export function LockerStatusPanel({ lockerId }: { readonly lockerId: string }) {
  const i18n = useI18n()
  const { m } = i18n
  const query = useLockerStatus(lockerId)
  const titleId = useId()
  const failure = query.isError ? classifyCatalogFailure(query.error) : null
  // A refresh the server refuses (403, 404) leaves no stale data: the locker can no longer be read.
  const gone = query.isRefetchError && (failure?.kind === 'forbidden' || failure?.kind === 'notFound')
  const locker = gone ? undefined : query.data
  const stale = query.isRefetchError && !gone

  // The panel itself is the stable place focus goes to when the control that had it leaves the page: the retry button of a
  // first-load alert (the skeleton replaces it while it runs), or a stale notice whose refresh is answered 403 or 404.
  const sectionRef = useRef<HTMLElement>(null)
  // The stale notice that had focus is gone: its target exists only after this commit, the title when the locker is still
  // shown and the panel when the answer took the data away.
  const focusLost = useRef(false)
  useLayoutEffect(() => {
    if (!focusLost.current) return
    focusLost.current = false
    ;(document.getElementById(titleId) ?? sectionRef.current)?.focus()
  })
  function retryFromAlert() {
    sectionRef.current?.focus()
    void query.refetch()
  }

  // Announced once, then only when the connection state changes: the same text on a refresh is not read again.
  const connectionLabel = locker === undefined ? null : connectionChip(locker.connectionStatus, i18n).label
  const announcement = locker !== undefined && connectionLabel !== null ? m.lockers.announce({ code: locker.code, connection: connectionLabel }) : query.isPending ? m.lockers.loadingStatus : ''

  return (
    <section ref={sectionRef} tabIndex={-1} className="ag-panel ag-lk" {...(locker === undefined ? { 'aria-label': m.lockers.statusLabel } : { 'aria-labelledby': titleId })} aria-busy={query.isPending || undefined}>
      <p className="ag-sr-only" role="status">
        {announcement}
      </p>
      {locker === undefined ? (
        failure !== null ? (
          <div className="ag-lk__alert">
            <LockerAlert failure={failure} onRetry={retryFromAlert} />
          </div>
        ) : (
          <div className="ag-lk__skel" aria-hidden="true">
            <span className="ag-skel__bar ag-skel__bar--title" />
            <span className="ag-skel__bar ag-skel__bar--block" />
            <span className="ag-skel__bar ag-skel__bar--facts" />
          </div>
        )
      ) : (
        <LockerBody locker={locker} titleId={titleId} stale={stale} retrying={query.isFetching} onRetry={() => void query.refetch()} returnFocus={() => (focusLost.current = true)} />
      )}
    </section>
  )
}

interface LockerBodyProps {
  readonly locker: LockerStatus
  readonly titleId: string
  readonly stale: boolean
  readonly retrying: boolean
  readonly onRetry: () => void
  readonly returnFocus: () => void
}

function LockerBody({ locker, titleId, stale, retrying, onRetry, returnFocus }: LockerBodyProps) {
  const i18n = useI18n()
  const { m } = i18n
  const chip = connectionChip(locker.connectionStatus, i18n)
  const note = connectionNote(locker.connectionStatus, i18n)
  const lastSignal = technicalInstantLabel(locker.lastSeenAt, i18n)
  const evaluated = technicalInstantLabel(locker.evaluatedAt, i18n)
  const tone = locker.connectionStatus === 'ONLINE' ? 'none' : locker.connectionStatus === 'OFFLINE' ? 'blocked' : 'unknown'
  const window = windowView(locker.currentWindow, i18n)

  return (
    <div className="ag-lk__body">
      {stale && (
        <div className="ag-lk__stale">
          <StaleNotice evaluatedAt={evaluatedTimeLabel(locker, i18n)} retrying={retrying} onRetry={onRetry} returnFocus={returnFocus} />
        </div>
      )}
      <p className="ag-overline">{m.lockers.statusLabel}</p>
      <h2 className="ag-lk__title" id={titleId} tabIndex={-1}>
        {locker.name !== '' && <>{locker.name} · </>}
        <span className={locker.code.length <= MAX_UNBROKEN_CODE ? 'ag-tnum ag-nowrap' : 'ag-tnum'}>{locker.code}</span>
      </h2>

      <div className="ag-lk__top">
        <div className={`ag-diag ag-diag--${tone}`}>
          <div className="ag-diag__row">
            <StatusChip role={chip.role} icon={chip.icon} size="lg">
              {chip.label}
            </StatusChip>
            <span className="ag-lk__signal">{lastSignal === null ? m.lockers.neverSignal : m.lockers.lastSignal({ time: lastSignal })}</span>
          </div>
          {note !== null && <p className="ag-diag__note ag-diag__note--unknown">{note}</p>}
          {hasUnrecognizedValue(locker) && <p className="ag-diag__note ag-diag__note--unknown">{m.equipment.unrecognizedNote}</p>}
          {evaluated !== null && <p className="ag-diag__note">{m.lockers.evaluatedNote({ time: evaluated })}</p>}
        </div>

        <div className="ag-lk__window">
          <h3 className="ag-overline ag-sec-title">
            {m.lockers.windowTitle}
            <ReadOnlyMark />
          </h3>
          <WindowFacts view={window} />
        </div>
      </div>

      <h3 className="ag-overline ag-sec-title ag-lk__sec">
        {m.lockers.compartmentsTitle({ count: locker.compartments.length })}
        <ReadOnlyMark />
      </h3>
      {locker.compartments.length === 0 ? <p className="ag-help">{m.lockers.noCompartments}</p> : <CompartmentTable locker={locker} />}
      <p className="ag-help ag-lk__foot">{m.lockers.readOnlyNote}</p>
    </div>
  )
}

function WindowFacts({ view }: { readonly view: ReturnType<typeof windowView> }) {
  const { m } = useI18n()
  if (view.kind === 'noSchedule') {
    return (
      <div className="ag-lk__noschedule">
        <p className="ag-lk__window-state">{m.lockers.noSchedule}</p>
        <p className="ag-help">{m.lockers.noScheduleHelp}</p>
      </div>
    )
  }
  return (
    <>
      <p className="ag-lk__window-state">
        <StatusChip role={view.kind === 'open' ? 'progress' : 'neutral'} icon="status-info">
          {view.kind === 'open' ? m.lockers.windowOpen : m.lockers.windowClosed}
        </StatusChip>
      </p>
      <dl className="ag-facts">
        {view.closesAt !== null && (
          <div>
            <dt>{m.lockers.windowClosesAt}</dt>
            <dd className="ag-tnum">{view.closesAt}</dd>
          </div>
        )}
        {view.nextOpensAt !== null && (
          <div>
            <dt>{m.lockers.windowNextOpensAt}</dt>
            <dd className="ag-tnum">{view.nextOpensAt}</dd>
          </div>
        )}
      </dl>
      {view.zone !== null && <p className="ag-help">{m.lockers.zoneNote({ zone: view.zone })}</p>}
    </>
  )
}

/**
 * A real table, with its roles written out: below the container width the rows stack as « label: value » lines
 * (locker-status.css), and browsers drop the table semantics of a table whose display changes.
 */
function CompartmentTable({ locker }: { readonly locker: LockerStatus }) {
  const { m } = useI18n()
  const t = m.lockers
  const noteId = useId()
  // The server keeps the last heartbeat's values on the cells while the locker is not ONLINE. A cell with an observation
  // is then a memory, not a current fact; a cell never observed has nothing to remember and keeps its own state.
  const lastKnown = (compartment: CompartmentStatus) => locker.connectionStatus !== 'ONLINE' && compartment.lastObservedAt !== null
  const anyLastKnown = locker.compartments.some(lastKnown)
  return (
    <div className="ag-lk-table-wrap">
      {anyLastKnown && (
        <p className="ag-lk__lastknown" id={noteId}>
          {t.lastKnownNote}
        </p>
      )}
      <table className="ag-lk-table" role="table" aria-describedby={anyLastKnown ? noteId : undefined}>
        <caption className="ag-sr-only">{t.compartmentsCaption({ code: locker.code })}</caption>
        <thead role="rowgroup">
          <tr role="row">
            {[t.colCompartment, t.colEnabled, t.colLink, t.colReader, t.colDoor, t.colLock, t.colLastObservation].map((label) => (
              <th key={label} scope="col" role="columnheader">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {locker.compartments.map((compartment) => (
            <CompartmentRow key={compartment.id} compartment={compartment} lastKnown={lastKnown(compartment)} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CompartmentRow({ compartment, lastKnown }: { readonly compartment: CompartmentStatus; readonly lastKnown: boolean }) {
  const i18n = useI18n()
  const t = i18n.m.lockers
  const observed = technicalInstantLabel(compartment.lastObservedAt, i18n)
  const state = (view: StateView) => (lastKnown ? asLastKnown(view) : view)
  return (
    <tr role="row" className={compartment.enabled ? undefined : 'ag-lk-table__off'}>
      <th scope="row" role="rowheader" className="ag-lk-table__code ag-tnum">
        {compartment.code}
      </th>
      <Cell label={t.colEnabled} state={enabledState(compartment.enabled, i18n)} />
      <Cell label={t.colLink} state={state(linkState(compartment.connectionStatus, i18n))} />
      <Cell label={t.colReader} state={state(readerState(compartment.rfidReaderStatus, i18n))} />
      <Cell label={t.colDoor} state={state(doorState(compartment.doorState, i18n))} />
      <Cell label={t.colLock} state={state(lockState(compartment.lockState, i18n))} />
      <td role="cell">
        <span className="ag-lk-table__label" aria-hidden="true">
          {t.colLastObservation}
        </span>
        <span className={observed === null ? 'ag-lk-table__none' : 'ag-tnum'}>{observed ?? t.noObservation}</span>
      </td>
    </tr>
  )
}

/** The label is repeated only when rows stack, and then hidden from assistive technology: the column header names the cell. */
function Cell({ label, state }: { readonly label: string; readonly state: StateView }) {
  const role = chipRole(state.tone)
  return (
    <td role="cell">
      <span className="ag-lk-table__label" aria-hidden="true">
        {label}
      </span>
      {role === null ? (
        <span>{state.label}</span>
      ) : (
        <StatusChip role={role} icon={state.icon}>
          {state.label}
        </StatusChip>
      )}
    </td>
  )
}
