import { createContext, useContext } from 'react'
import { unconfiguredLockerGateway, type LockerGateway } from './lockerGateway'

export const LockerGatewayContext = createContext<LockerGateway>(unconfiguredLockerGateway)

export function useLockerGateway(): LockerGateway {
  return useContext(LockerGatewayContext)
}
