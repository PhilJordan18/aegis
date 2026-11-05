package ca.aegis.control.asset;

/**
 * Purpose of a readiness evaluation (document 06, section 4.2). It only decides whether an active reservation of the
 * evaluated user is compatible: it is for the checkout of that reservation, and for nothing else.
 */
public enum ReadinessContext {
    /** Catalog or detail read. */
    GENERAL,
    /** Creation of a new reservation. */
    NEW_RESERVATION,
    /** Checkout of a reservation already held by the evaluated user. */
    CHECKOUT
}
