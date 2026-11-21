package ca.aegis.control.identity;

import java.util.UUID;

/** Document 09, section 8.8: the identity of a user as another reader sees it; it grants no read right. */
public record UserSummary(UUID id, String displayName) {
}
