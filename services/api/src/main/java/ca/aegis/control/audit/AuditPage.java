package ca.aegis.control.audit;

import java.util.List;

/** A page of the audit timeline (document 09, section 19.1); {@code nextCursor} is null when {@code hasMore} is false. */
public record AuditPage(List<AuditEventView> items, String nextCursor, boolean hasMore) {
}
