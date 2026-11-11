package ca.aegis.control.shared.web;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Validated filters of the administrative lists (document 09, sections 17 to 19). Raw strings are parsed here so
 * that every malformed filter of a request is reported together as {@code 400 VALIDATION_ERROR}, {@code INVALID_VALUE}
 * (section 7.1). An absent parameter is {@code null}; a present but blank one is invalid, never ignored.
 */
public final class QueryFilters {

    private final List<ProblemResponse.Violation> violations = new ArrayList<>();

    public UUID uuid(String field, String raw) {
        if (raw == null) {
            return null;
        }
        try {
            String value = raw.strip();
            // UUID.fromString accepts shortened groups such as "1-1-1-1-1"; only the canonical form is an id.
            if (value.length() == 36) {
                return UUID.fromString(value);
            }
        } catch (IllegalArgumentException invalid) {
            // Reported below.
        }
        return invalid(field, "Ce paramètre doit être un UUID.");
    }

    /** An instant with its offset ({@code 2026-11-11T15:00:00Z} or {@code ...-05:00}); a local time is refused. */
    public Instant instant(String field, String raw) {
        if (raw == null) {
            return null;
        }
        try {
            return OffsetDateTime.parse(raw.strip()).toInstant();
        } catch (DateTimeParseException invalid) {
            return invalid(field, "Ce paramètre doit être un instant ISO 8601 avec son décalage.");
        }
    }

    public <E extends Enum<E>> E enumeration(String field, String raw, Class<E> type) {
        if (raw == null) {
            return null;
        }
        try {
            return Enum.valueOf(type, raw.strip());
        } catch (IllegalArgumentException invalid) {
            return invalid(field, "Cette valeur n'est pas reconnue.");
        }
    }

    /**
     * Provisional rule D2 of the 11 November 2026 matrix (#67), pending Philippe's decision: {@code from} is inclusive
     * and {@code to} exclusive, so an empty or inverted interval is refused rather than answered with an empty page.
     */
    public void requireOrdered(Instant from, Instant to) {
        if (from != null && to != null && !from.isBefore(to)) {
            invalid("to", "La borne to doit être postérieure à from.");
        }
    }

    /** Throws every violation collected so far, sorted like Bean Validation's. */
    public void validate() {
        if (!violations.isEmpty()) {
            throw InvalidRequestException.of(violations);
        }
    }

    private <T> T invalid(String field, String message) {
        violations.add(new ProblemResponse.Violation(field, "INVALID_VALUE", message));
        return null;
    }
}
