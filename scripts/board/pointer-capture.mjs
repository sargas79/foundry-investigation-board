/**
 * Best-effort pointer capture.
 *
 * `setPointerCapture` and `releasePointerCapture` throw `NotFoundError` whenever the pointer id is
 * not currently active — which happens if the pointer was cancelled by the OS, if the element left
 * the document mid-gesture, or for synthetic events. Capture is only an optimisation here (it keeps
 * events flowing to one element while the button is held), so a failure must never take down the
 * gesture around it: dropping a drag on release would silently discard the user's move and leave
 * the handler believing a drag was still in progress.
 */

/**
 * Capture a pointer on an element, ignoring failure.
 * @param {Element} element
 * @param {number} pointerId
 * @returns {boolean}   Whether capture was actually taken.
 */
export function capturePointer(element, pointerId) {
  try {
    element.setPointerCapture(pointerId);
    return true;
  }
  catch {
    return false;
  }
}

/**
 * Release a pointer captured on an element, ignoring failure.
 * @param {Element} element
 * @param {number} pointerId
 */
export function releasePointer(element, pointerId) {
  try {
    if ( element.hasPointerCapture?.(pointerId) ) element.releasePointerCapture(pointerId);
  }
  catch {
    // The pointer is already gone, which is all releasing was meant to achieve.
  }
}
