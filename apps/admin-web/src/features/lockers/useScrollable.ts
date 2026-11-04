import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * True while the element's content is larger than its box, so it scrolls on its own. A scrolling region must be reachable
 * by keyboard (WCAG 2.1.1), but a region that does not scroll must not be a tab stop: the caller gives it `tabIndex={0}`
 * only while this is true. `watch` changes when the content is replaced; resizes of the element and of its children are
 * observed, since a child growing is what makes the region start to scroll.
 */
export function useScrollable<T extends HTMLElement>(watch: string): readonly [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [scrollable, setScrollable] = useState(false)

  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    const measure = () => setScrollable(element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    for (const child of element.children) observer.observe(child)
    return () => observer.disconnect()
  }, [watch])

  return [ref, scrollable]
}
