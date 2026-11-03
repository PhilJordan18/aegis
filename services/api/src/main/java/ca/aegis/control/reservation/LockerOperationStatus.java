package ca.aegis.control.reservation;

/** States of document 05, section 5, as {@code ck_locker_operations_status} stores them. */
enum LockerOperationStatus {
    REQUESTED,
    AWAITING_LOCAL_PROOF,
    AUTHORIZED,
    COMMAND_SENT,
    COMMAND_ACKNOWLEDGED,
    DOOR_OPENED,
    OBSERVATION_RECEIVED,
    CONFIRMED,
    FAILED,
    EXPIRED,
    ANOMALY;

    /** No lock command was ever authorized: the attempt still waits for, or has not reached, its local proof. */
    boolean beforeAuthorization() {
        return this == REQUESTED || this == AWAITING_LOCAL_PROOF;
    }
}
