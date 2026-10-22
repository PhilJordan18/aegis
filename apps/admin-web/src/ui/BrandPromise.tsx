import { PageHeading } from '../app/PageHeading'
import { useI18n } from '../i18n/useI18n'
import './brand-promise.css'

/**
 * The common brand text of the entry screens: the signature « Prêt. Autorisé. Prouvé. »
 * (« Ready. Authorized. Proven. »), the tagline and the description. On the landing page
 * the signature is the page's h1 (`asHeading`); on the sign-in page it is a plain
 * paragraph and « Connexion » stays the h1.
 */
export function BrandPromise({ asHeading = false }: { readonly asHeading?: boolean }) {
  const { m } = useI18n()
  const { signature } = m.brand
  // One accessible string: each word is a block, separated by a space for assistive technology.
  const words = (
    <>
      <span className="ag-promise__line">{signature.ready}</span>{' '}
      <span className="ag-promise__line">{signature.authorized}</span>{' '}
      <span className="ag-promise__line ag-promise__line--proof">{signature.proven}</span>
    </>
  )
  return (
    <div className="ag-promise">
      <p className="ag-overline ag-promise__tagline">{m.brand.tagline}</p>
      {asHeading ? <PageHeading className="ag-promise__signature">{words}</PageHeading> : <p className="ag-promise__signature">{words}</p>}
      <p className="ag-promise__description">{m.brand.description}</p>
      <div className="ag-promise__rule" aria-hidden="true" />
    </div>
  )
}
