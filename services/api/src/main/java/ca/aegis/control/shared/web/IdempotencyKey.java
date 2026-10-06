package ca.aegis.control.shared.web;

/**
 * The {@code Idempotency-Key} of a sensitive mutation (document 09, sections 6.2 and 20). Declaring a parameter of
 * this type on a handler makes the header mandatory: a missing or blank key is refused with
 * {@code IDEMPOTENCY_KEY_REQUIRED} and a key longer than 128 characters with {@code VALIDATION_ERROR}, before the
 * request body is read.
 */
public record IdempotencyKey(String value) {

    public static final String HEADER = "Idempotency-Key";
    public static final int MAX_LENGTH = 128;

    static IdempotencyKey require(String header) {
        if (header == null || header.isBlank()) {
            throw new IdempotencyKeyRequiredException();
        }
        if (header.length() > MAX_LENGTH) {
            throw InvalidRequestException.of(HEADER, "SIZE", "La clé d'idempotence dépasse 128 caractères.");
        }
        return new IdempotencyKey(header);
    }

    static final class IdempotencyKeyRequiredException extends ApiException {

        IdempotencyKeyRequiredException() {
            super(ApiError.IDEMPOTENCY_KEY_REQUIRED);
        }
    }
}
