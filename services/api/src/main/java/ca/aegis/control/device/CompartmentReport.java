package ca.aegis.control.device;

import java.util.UUID;

/** One cell of a heartbeat (document 10, section 14), with values from the {@code compartments} CHECK lists. */
record CompartmentReport(UUID compartmentId, int cellAddress, String connectionStatus, String readerStatus,
        String doorState, String lockState) {
}
