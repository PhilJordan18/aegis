package ca.aegis.control.shared.web;

import java.util.ArrayList;
import java.util.List;

/**
 * Validated {@code page} and {@code size} parameters (document 09, sections 3 and 11.1): page 0 or more, size 1 to
 * 100, 20 by default. Raw strings are parsed here so that a malformed value is reported as a field violation.
 */
public record PageQuery(int page, int size) {

    public static final int DEFAULT_SIZE = 20;
    public static final int MAX_SIZE = 100;

    public static PageQuery parse(String page, String size) {
        List<ProblemResponse.Violation> violations = new ArrayList<>();
        int pageNumber = parse(page, 0, 0, Integer.MAX_VALUE, "page",
                "La page doit être un entier positif ou nul.", violations);
        int pageSize = parse(size, DEFAULT_SIZE, 1, MAX_SIZE, "size",
                "La taille de page doit être comprise entre 1 et 100.", violations);
        if (!violations.isEmpty()) {
            throw new InvalidRequestException(violations);
        }
        return new PageQuery(pageNumber, pageSize);
    }

    public long offset() {
        return (long) page * size;
    }

    private static int parse(String raw, int fallback, int min, int max, String field, String message,
            List<ProblemResponse.Violation> violations) {
        if (raw == null) {
            return fallback;
        }
        try {
            int value = Integer.parseInt(raw.strip());
            if (value >= min && value <= max) {
                return value;
            }
        } catch (NumberFormatException invalid) {
            // Reported below as the same violation as an out-of-range number.
        }
        violations.add(new ProblemResponse.Violation(field, "INVALID_VALUE", message));
        return fallback;
    }
}
