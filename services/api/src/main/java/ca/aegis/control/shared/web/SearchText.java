package ca.aegis.control.shared.web;

import java.text.BreakIterator;
import java.util.Locale;
import java.util.Optional;

/**
 * User search text (document 09, section 22.3, and ADR-014): outer Unicode spaces removed, then 1 to 100 extended
 * grapheme clusters (UAX #29) and no control character (see {@link PlainText}) before any SQL is run. Web and iOS apply
 * the same rule to the shared corpus {@code docs/cahier-conception/09-corpus-recherche-q.json}. The pattern escapes
 * the {@code LIKE} wildcards and must be used with {@code ESCAPE '\'}.
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
        String text = strip(raw);
        int length = graphemeCount(text);
        if (length == 0 || length > MAX_LENGTH) {
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

    /**
     * Removes the outer characters of general category Z (Zs, Zl, Zp), one code point at a time. Unlike
     * {@link String#strip()}, this keeps the outer control characters, which {@link PlainText} then refuses, and
     * removes the no-break spaces U+00A0, U+2007 and U+202F.
     */
    static String strip(String text) {
        int start = 0;
        int end = text.length();
        while (start < end && Character.isSpaceChar(text.charAt(start))) {
            start++;
        }
        while (end > start && Character.isSpaceChar(text.charAt(end - 1))) {
            end--;
        }
        return text.substring(start, end);
    }

    /** Extended grapheme clusters, as {@link BreakIterator} counts them since JDK 20, in the JDK's Unicode version. */
    static int graphemeCount(String text) {
        BreakIterator graphemes = BreakIterator.getCharacterInstance(Locale.ROOT);
        graphemes.setText(text);
        int count = 0;
        while (graphemes.next() != BreakIterator.DONE) {
            count++;
        }
        return count;
    }
}
