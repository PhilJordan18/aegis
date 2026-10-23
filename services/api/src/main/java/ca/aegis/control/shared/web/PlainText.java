package ca.aegis.control.shared.web;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;

/**
 * Text that holds no control character (U+0000 to U+001F, U+007F to U+009F) and no unpaired surrogate. PostgreSQL
 * refuses NUL, the driver replaces an unpaired surrogate by {@code ?}, and any other control character would be
 * stored invisibly; the value is therefore refused before any SQL. A multiline text still accepts tabulation, line
 * feed and carriage return. Reported with the violation code {@code INVALID_VALUE}; a {@code null} value is valid.
 */
@Documented
@Constraint(validatedBy = PlainText.Validator.class)
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT})
@Retention(RetentionPolicy.RUNTIME)
public @interface PlainText {

    boolean multiline() default false;

    String message() default "Ce champ contient un caractère non autorisé.";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    final class Validator implements ConstraintValidator<PlainText, CharSequence> {

        private boolean multiline;

        @Override
        public void initialize(PlainText constraint) {
            multiline = constraint.multiline();
        }

        @Override
        public boolean isValid(CharSequence value, ConstraintValidatorContext context) {
            return value == null || isPlain(value, multiline);
        }

        /** The same rule for a value that is not a validated body, such as a query parameter or a header. */
        public static boolean isPlain(CharSequence text, boolean multiline) {
            int length = text.length();
            for (int index = 0; index < length; index++) {
                char character = text.charAt(index);
                if (Character.isHighSurrogate(character)) {
                    if (index + 1 < length && Character.isLowSurrogate(text.charAt(index + 1))) {
                        index++;
                        continue;
                    }
                    return false;
                }
                if (Character.isLowSurrogate(character)) {
                    return false;
                }
                if (Character.isISOControl(character) && !(multiline && isLineLayout(character))) {
                    return false;
                }
            }
            return true;
        }

        private static boolean isLineLayout(char character) {
            return character == '\t' || character == '\n' || character == '\r';
        }
    }
}
