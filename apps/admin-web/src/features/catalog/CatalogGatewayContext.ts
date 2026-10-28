import { createContext, useContext } from 'react'
import { unconfiguredCatalogGateway, type CatalogGateway } from './catalogGateway'

export const CatalogGatewayContext = createContext<CatalogGateway>(unconfiguredCatalogGateway)

export function useCatalogGateway(): CatalogGateway {
  return useContext(CatalogGatewayContext)
}
