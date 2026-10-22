package ca.aegis.control.shared.web;

import java.util.Locale;
import java.util.Optional;

/**
 * User search text (document 09, section 22.3): outer spaces removed, empty text refused, at most 100 characters and
 * no control character (see {@link PlainText}) before any SQL is run. The pattern escapes the {@code LIKE} wildcards
 * and must be used with {@code ESCAPE '\'}.
 */
public final class SearchText {

    public static final int MAX_LENGTH = 100;

    private SearchText() {
    }

    /** Lower-case {@code LIKE} pattern matching the text anywhere; empty when the parameter is absent. */
    public static Optional<String> containsPattern(String raw) {
        if (raw == null) {
            return Optional.empty();
        }
        String text = raw.strip();
        if (text.isEmpty() || text.length() > MAX_LENGTH) {
            throw InvalidRequestException.of("q", "SIZE", "La recherche doit contenir de 1 à 100 caractères.");
        }
        if (!PlainText.Validator.isPlain(text, false)) {
            throw InvalidRequestException.of("q", "INVALID_VALUE", "La recherche contient un caractère non autorisé.");
        }
        String escaped = text.toLowerCase(Locale.ROOT)
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_");
        return Optional.of("%" + escaped + "%");
    }
}
