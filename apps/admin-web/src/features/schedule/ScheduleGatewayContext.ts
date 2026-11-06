import { createContext, useContext } from 'react'
import { unconfiguredScheduleGateway, type ScheduleGateway } from './scheduleGateway'

export const ScheduleGatewayContext = createContext<ScheduleGateway>(unconfiguredScheduleGateway)

export function useScheduleGateway(): ScheduleGateway {
  return useContext(ScheduleGatewayContext)
}
