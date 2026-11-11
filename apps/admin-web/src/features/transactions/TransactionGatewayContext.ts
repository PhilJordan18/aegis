import { createContext, useContext } from 'react'
import { unconfiguredTransactionGateway, type TransactionGateway } from './transactionGateway'

export const TransactionGatewayContext = createContext<TransactionGateway>(unconfiguredTransactionGateway)

export function useTransactionGateway(): TransactionGateway {
  return useContext(TransactionGatewayContext)
}
