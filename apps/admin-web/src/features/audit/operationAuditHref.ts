import { auditHref, NO_FILTERS } from './auditFilters'

/** « Audit of this operation »: the audit screen filtered on the operation, with the existing address format. */
export const operationAuditHref = (operationId: string): string => auditHref({ ...NO_FILTERS, operationId })
