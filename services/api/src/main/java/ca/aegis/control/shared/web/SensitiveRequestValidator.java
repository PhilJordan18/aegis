package ca.aegis.control.shared.web;

import java.util.List;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;

import org.springframework.stereotype.Component;

/**
 * Validates a body that carries a password or another secret. {@code @Valid} is not used for such bodies because
 * the resulting {@code MethodArgumentNotValidException} embeds every rejected value in its message, which Spring
 * MVC logs at DEBUG. The response is the same {@code VALIDATION_ERROR} with field violations.
 */
@Component
public class SensitiveRequestValidator {

    private final Validator validator;

    public SensitiveRequestValidator(Validator validator) {
        this.validator = validator;
    }

    public void validate(Object body) {
        List<ProblemResponse.Violation> violations = validator.validate(body).stream()
                .map(SensitiveRequestValidator::violation)
                .sorted(ProblemResponse.Violation.ORDER)
                .toList();
        if (!violations.isEmpty()) {
            throw new InvalidRequestException(violations);
        }
    }

    private static ProblemResponse.Violation violation(ConstraintViolation<Object> violation) {
        String constraint = violation.getConstraintDescriptor().getAnnotation().annotationType().getSimpleName();
        return new ProblemResponse.Violation(violation.getPropertyPath().toString(),
                ApiExceptionHandler.violationCode(constraint), violation.getMessage());
    }
}
