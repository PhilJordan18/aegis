import { createContext, useContext } from 'react'
import { unconfiguredAnomalyGateway, type AnomalyGateway } from './anomalyGateway'

export const AnomalyGatewayContext = createContext<AnomalyGateway>(unconfiguredAnomalyGateway)

export function useAnomalyGateway(): AnomalyGateway {
  return useContext(AnomalyGatewayContext)
}
