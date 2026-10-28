package ca.aegis.control.shared.web;

import java.util.List;

/** A request refused by validation; its message names the error only, never a rejected value. */
public final class InvalidRequestException extends ApiException {

    private final List<ProblemResponse.Violation> violations;

    InvalidRequestException(List<ProblemResponse.Violation> violations) {
        super(ApiError.VALIDATION_ERROR);
        this.violations = List.copyOf(violations);
    }

    /** A single field refused by an application rule rather than by Bean Validation. */
    public static InvalidRequestException of(String field, String code, String message) {
        return new InvalidRequestException(List.of(new ProblemResponse.Violation(field, code, message)));
    }

    /** Several fields refused by application rules, reported together and sorted like Bean Validation's. */
    public static InvalidRequestException of(List<ProblemResponse.Violation> violations) {
        return new InvalidRequestException(violations.stream().sorted(ProblemResponse.Violation.ORDER).toList());
    }

    @Override
    public List<ProblemResponse.Violation> violations() {
        return violations;
    }
}
