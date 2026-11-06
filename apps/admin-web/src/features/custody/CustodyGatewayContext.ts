import { createContext, useContext } from 'react'
import { unconfiguredCustodyGateway, type CustodyGateway } from './custodyGateway'

export const CustodyGatewayContext = createContext<CustodyGateway>(unconfiguredCustodyGateway)

export function useCustodyGateway(): CustodyGateway {
  return useContext(CustodyGatewayContext)
}
