import type { Ref } from 'react'
import { useI18n } from '../../../i18n/useI18n'
import { Alert } from '../../../ui/Alert'
import type { FormAlertContent } from './formFeedback'

/** The single form-level message of a dialog, focused when it appears so it is read at once. */
export function FormAlert({ content, focusRef }: { readonly content: FormAlertContent; readonly focusRef: Ref<HTMLDivElement> }) {
  const { m } = useI18n()
  return (
    <div className="ag-dialog__alert" ref={focusRef} tabIndex={-1}>
      <Alert kind="error" icon="status-error" title={content.title} code={content.traceId ?? undefined} codeLabel={m.equipment.traceIdLabel}>
        {content.body}
      </Alert>
    </div>
  )
}
