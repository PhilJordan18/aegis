import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Icon } from './Icon'
import './form.css'

/**
 * Form controls of the approved field pattern (sign-in, identity v3): persistent label above, no placeholder,
 * one message slot under the control, `aria-invalid` and `aria-describedby` to the help and the error.
 */
interface FieldFrameProps {
  readonly label: string
  readonly help?: string
  readonly error?: string | null
  readonly optional?: string
  /** Live detail under the control (a character count): read with the help, before the error. */
  readonly counter?: string
  readonly children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

function FieldFrame({ label, help, error, optional, counter, children }: FieldFrameProps) {
  const id = useId()
  const helpId = `${id}-help`
  const counterId = `${id}-counter`
  const errorId = `${id}-error`
  const describedBy = [help ? helpId : null, counter ? counterId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  return (
    <div className="ag-ff">
      <label className="ag-ff__label" htmlFor={id}>
        {label}
        {optional && <span className="ag-ff__optional"> {optional}</span>}
      </label>
      {help && (
        <p className="ag-ff__help" id={helpId}>
          {help}
        </p>
      )}
      {children({ id, describedBy, invalid: Boolean(error) })}
      {counter && (
        <p className="ag-ff__counter" id={counterId}>
          {counter}
        </p>
      )}
      <div className="ag-ff__slot">
        {error && (
          <p className="ag-ff__error" id={errorId}>
            <Icon name="status-error" />
            <span>{error}</span>
          </p>
        )}
      </div>
    </div>
  )
}

type Common = { readonly label: string; readonly help?: string; readonly error?: string | null; readonly optional?: string }

export function TextField({ label, help, error, optional, ...input }: Common & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>) {
  return (
    <FieldFrame label={label} help={help} error={error} optional={optional}>
      {({ id, describedBy, invalid }) => (
        <input {...input} id={id} className="ag-ff__control" aria-describedby={describedBy} aria-invalid={invalid || undefined} />
      )}
    </FieldFrame>
  )
}

export function TextAreaField({ label, help, error, optional, counter, ...textarea }: Common & { readonly counter?: string } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>) {
  return (
    <FieldFrame label={label} help={help} error={error} optional={optional} counter={counter}>
      {({ id, describedBy, invalid }) => (
        <textarea {...textarea} id={id} className="ag-ff__control ag-ff__control--area" aria-describedby={describedBy} aria-invalid={invalid || undefined} />
      )}
    </FieldFrame>
  )
}

export function SelectField({ label, help, error, optional, children, ...select }: Common & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'>) {
  return (
    <FieldFrame label={label} help={help} error={error} optional={optional}>
      {({ id, describedBy, invalid }) => (
        <select {...select} id={id} className="ag-ff__control ag-ff__control--select" aria-describedby={describedBy} aria-invalid={invalid || undefined}>
          {children}
        </select>
      )}
    </FieldFrame>
  )
}

export function CheckboxField({ label, help, error, ...input }: Omit<Common, 'optional'> & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'>) {
  const id = useId()
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  return (
    <div className="ag-ff ag-ff--check">
      <div className="ag-ff__check">
        <input {...input} type="checkbox" id={id} aria-describedby={describedBy} aria-invalid={error ? true : undefined} />
        <label htmlFor={id} className="ag-ff__label">
          {label}
        </label>
      </div>
      {help && (
        <p className="ag-ff__help" id={helpId}>
          {help}
        </p>
      )}
      <div className="ag-ff__slot">
        {error && (
          <p className="ag-ff__error" id={errorId}>
            <Icon name="status-error" />
            <span>{error}</span>
          </p>
        )}
      </div>
    </div>
  )
}

interface ChoiceFieldProps<T extends string> {
  readonly legend: string
  readonly name: string
  readonly value: T | ''
  readonly options: readonly { readonly value: T; readonly label: string }[]
  readonly onChange: (value: T) => void
  readonly error?: string | null
  readonly disabled?: boolean
}

/** Native radio group in a fieldset (one tab stop, arrows move): used for short closed lists. */
export function ChoiceField<T extends string>({ legend, name, value, options, onChange, error, disabled }: ChoiceFieldProps<T>) {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <fieldset className="ag-ff ag-ff--choice" aria-describedby={error ? errorId : undefined} aria-invalid={error ? true : undefined} disabled={disabled}>
      <legend className="ag-ff__label">{legend}</legend>
      <div className="ag-ff__choices">
        {options.map((option) => (
          <label key={option.value} className="ag-ff__choice">
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <div className="ag-ff__slot">
        {error && (
          <p className="ag-ff__error" id={errorId}>
            <Icon name="status-error" />
            <span>{error}</span>
          </p>
        )}
      </div>
    </fieldset>
  )
}
