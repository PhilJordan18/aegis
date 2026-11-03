package ca.aegis.control.reservation;

/** States of a local access challenge, as {@code ck_local_challenge_status} stores them (document 08, section 4.6). */
enum LocalChallengeStatus {
    PENDING,
    CONSUMED,
    EXPIRED,
    INVALIDATED
}
