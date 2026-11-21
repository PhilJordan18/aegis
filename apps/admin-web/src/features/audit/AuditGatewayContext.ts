import { createContext, useContext } from 'react'
import { unconfiguredAuditGateway, type AuditGateway } from './auditGateway'

export const AuditGatewayContext = createContext<AuditGateway>(unconfiguredAuditGateway)

export function useAuditGateway(): AuditGateway {
  return useContext(AuditGatewayContext)
}
