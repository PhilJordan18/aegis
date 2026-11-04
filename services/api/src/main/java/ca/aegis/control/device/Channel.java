package ca.aegis.control.device;

/** The two topics a hub publishes on (document 10, section 5); the backend only subscribes to these. */
enum Channel {
    EVENTS,
    STATUS
}
