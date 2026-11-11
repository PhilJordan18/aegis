package ca.aegis.control.anomaly;

/**
 * States of document 05: {@code ACKNOWLEDGED} means recognized by an administrator, never corrected; only a coherent
 * physical observation resolves an anomaly.
 */
enum AnomalyStatus {
    OPEN,
    ACKNOWLEDGED,
    RESOLVED
}
