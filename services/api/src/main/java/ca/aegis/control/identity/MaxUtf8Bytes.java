package ca.aegis.control.identity;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.nio.charset.StandardCharsets;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;

/**
 * Bounds a value in UTF-8 bytes rather than characters. BCrypt only reads the first 72 bytes of a password,
 * so the password is limited before hashing (document 09, section 10.2).
 */
@Documented
@Constraint(validatedBy = MaxUtf8Bytes.Validator.class)
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT})
@Retention(RetentionPolicy.RUNTIME)
@interface MaxUtf8Bytes {

    int value();

    String message() default "Cette valeur est trop longue.";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    final class Validator implements ConstraintValidator<MaxUtf8Bytes, String> {

        private int maxBytes;

        @Override
        public void initialize(MaxUtf8Bytes constraint) {
            maxBytes = constraint.value();
        }

        @Override
        public boolean isValid(String value, ConstraintValidatorContext context) {
            return value == null || value.getBytes(StandardCharsets.UTF_8).length <= maxBytes;
        }
    }
}
