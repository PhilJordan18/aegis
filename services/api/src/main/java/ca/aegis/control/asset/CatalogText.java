package ca.aegis.control.asset;

/**
 * Text normalization of catalog requests: outer spaces never distinguish two codes or names, and an optional field
 * left blank is stored as absent rather than as an empty string.
 */
final class CatalogText {

    private CatalogText() {
    }

    /** Stripped; a blank value becomes empty so that {@code @NotBlank} still refuses it. */
    static String required(String value) {
        return value == null ? null : value.strip();
    }

    static String optional(String value) {
        if (value == null) {
            return null;
        }
        String stripped = value.strip();
        return stripped.isEmpty() ? null : stripped;
    }
}
