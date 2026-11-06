/**
 * jsdom has `<dialog>` but not `showModal`/`close`: enough of them for the open state, and Escape firing the
 * cancelable `cancel` event as a browser does.
 */
export function installDialogPolyfill() {
  const proto = HTMLDialogElement.prototype
  if (typeof proto.showModal === 'function') return
  const escape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    const dialog = event.currentTarget as HTMLDialogElement
    if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close()
  }
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
    this.addEventListener('keydown', escape)
  }
  proto.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.removeEventListener('keydown', escape)
  }
}
