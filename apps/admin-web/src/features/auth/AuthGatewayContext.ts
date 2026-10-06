import { createContext, useContext } from 'react'
import { unconfiguredAuthGateway, type AuthGateway } from './authGateway'

export const AuthGatewayContext = createContext<AuthGateway>(unconfiguredAuthGateway)

export function useAuthGateway(): AuthGateway {
  return useContext(AuthGatewayContext)
}
