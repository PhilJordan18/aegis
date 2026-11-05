package ca.aegis.control.asset;

/** Transactional availability of an asset, always derived (document 03, section 5.2). */
public enum Availability {
    AVAILABLE,
    RESERVED,
    BORROWED,
    UNAVAILABLE
}
