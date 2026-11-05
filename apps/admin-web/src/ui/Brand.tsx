import { Link } from '../app/Link'
import { pathOf } from '../app/routes'
import { useI18n } from '../i18n/useI18n'
import markDark from '../assets/brand/aegis-core-mark-dark.svg'
import markLight from '../assets/brand/aegis-core-mark.svg'
import './brand.css'

/**
 * The single brand component and the swap point of the provisional Aegis Core
 * identity: the symbol (src/assets/brand/, one file per appearance, chosen by
 * `data-theme` in brand.css), the word « aegis » set in Geist and the application
 * name « Manager » as text. Names are never translated; only the link's accessible
 * name is. « Manager » stays visible on small screens, on a second line.
 */
export function Brand() {
  const { m } = useI18n()
  return (
    <Link className="ag-brand" to={pathOf('landing')} aria-label={m.brand.homeLabel}>
      <span className="ag-brand__mark" aria-hidden="true">
        <img className="ag-brand__img ag-brand__img--light" src={markLight} alt="" width="64" height="64" />
        <img className="ag-brand__img ag-brand__img--dark" src={markDark} alt="" width="64" height="64" />
      </span>
      <span className="ag-brand__text">
        <span className="ag-brand__word">aegis</span>
        <span className="ag-brand__app">Manager</span>
      </span>
    </Link>
  )
}
