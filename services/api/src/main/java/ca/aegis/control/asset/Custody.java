package ca.aegis.control.asset;

import java.util.UUID;

/**
 * Transactional facts that decide availability: archival, the active reservation and an unfinished loan
 * ({@code ACTIVE} or {@code RETURN_PENDING}). Only their existence and the reservation holder are kept; nothing about
 * another holder ever leaves the backend.
 *
 * @param activeReservationHolderId the user holding the {@code ACTIVE} reservation of the asset, or {@code null}
 */
record Custody(boolean archived, UUID activeReservationHolderId, boolean unfinishedLoan) {

    static Custody archivalOnly(boolean archived) {
        return new Custody(archived, null, false);
    }

    /** Priority of document 03, section 5.2: loan, then reservation, then archival. */
    Availability availability() {
        if (unfinishedLoan) {
            return Availability.BORROWED;
        }
        if (activeReservationHolderId != null) {
            return Availability.RESERVED;
        }
        return archived ? Availability.UNAVAILABLE : Availability.AVAILABLE;
    }

    /**
     * Document 06, sections 4.2 and 4.4: an archived asset or an unfinished loan is never compatible; an active
     * reservation is compatible only with the checkout of its own holder.
     */
    boolean compatibleWith(UUID userId, ReadinessContext context) {
        if (archived || unfinishedLoan) {
            return false;
        }
        return activeReservationHolderId == null
                || (context == ReadinessContext.CHECKOUT && activeReservationHolderId.equals(userId));
    }
}
