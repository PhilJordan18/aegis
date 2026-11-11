package ca.aegis.control.reservation;

/** {@code requiredAction} of document 09, sections 8.5 and 15.4, derived from the operation status only. */
enum RequiredAction {
    SCAN_HUB_QR,
    WAIT,
    NONE;

    static RequiredAction of(LockerOperationStatus status) {
        return switch (status) {
            case AWAITING_LOCAL_PROOF -> SCAN_HUB_QR;
            case CONFIRMED, FAILED, EXPIRED, ANOMALY -> NONE;
            case REQUESTED, AUTHORIZED, COMMAND_SENT, COMMAND_ACKNOWLEDGED, DOOR_OPENED, OBSERVATION_RECEIVED -> WAIT;
        };
    }
}
