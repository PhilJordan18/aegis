package ca.aegis.control.shared.web;

import java.util.List;

/** A request body refused by Bean Validation; its message names the error only, never a rejected value. */
public final class InvalidRequestException extends ApiException {

    private final List<ProblemResponse.Violation> violations;

    InvalidRequestException(List<ProblemResponse.Violation> violations) {
        super(ApiError.VALIDATION_ERROR);
        this.violations = List.copyOf(violations);
    }

    @Override
    public List<ProblemResponse.Violation> violations() {
        return violations;
    }
}
