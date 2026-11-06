import { useEffect, type RefObject } from 'react'
import type { FormFeedback } from './formFeedback'

/**
 * Moves focus once a submit's feedback is rendered: to the alert when there is one, otherwise to the first invalid
 * field. An effect, not an animation frame: after an `await`, React may render after the next frame, and the alert
 * would not exist yet. Feedback without an alert or an invalid field (the initial state, a new submit) moves nothing.
 */
export function useFeedbackFocus(feedback: FormFeedback, alertRef: RefObject<HTMLElement | null>, formRef: RefObject<HTMLFormElement | null>) {
  useEffect(() => {
    if (feedback.alert !== null) alertRef.current?.focus()
    else formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [feedback, alertRef, formRef])
}
