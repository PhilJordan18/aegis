package ca.aegis.control.asset;

import java.util.UUID;

/** The facts of a compartment that a placement depends on. */
record CompartmentRecord(UUID id, UUID lockerId, String code, boolean enabled) {
}
