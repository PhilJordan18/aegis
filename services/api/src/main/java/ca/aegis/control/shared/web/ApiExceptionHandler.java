package ca.aegis.control.shared.web;

import java.util.List;
import java.util.Locale;

import jakarta.servlet.http.HttpServletRequest;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.ServletWebRequest;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.exc.UnrecognizedPropertyException;

/**
 * Translates every MVC-level failure into the contract error body. Framework statuses without a dedicated
 * contract code (405, 406, 415) keep their HTTP status and use {@code VALIDATION_ERROR}.
 */
@RestControllerAdvice
public class ApiExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    private final Problems problems;

    public ApiExceptionHandler(Problems problems) {
        this.problems = problems;
    }

    @ExceptionHandler(ApiException.class)
    ResponseEntity<Object> handleApiException(ApiException ex, HttpServletRequest request) {
        return problems.entity(ex.error(), ex.error().status().value(), ex.headers(), request, ex.violations());
    }

    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<Object> handleAccessDenied(AccessDeniedException ex, HttpServletRequest request) {
        return problems.entity(ApiError.FORBIDDEN, request);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Object> handleUnexpected(Exception ex, HttpServletRequest request) {
        log.error("Unexpected error while handling {} {}", request.getMethod(), request.getRequestURI(), ex);
        return problems.entity(ApiError.INTERNAL_ERROR, request);
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException ex,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        List<ProblemResponse.Violation> violations = ex.getBindingResult().getFieldErrors().stream()
                .map(error -> new ProblemResponse.Violation(error.getField(), violationCode(error.getCode()),
                        error.getDefaultMessage()))
                .sorted(ProblemResponse.Violation.ORDER)
                .toList();
        return problems.entity(ApiError.VALIDATION_ERROR, status.value(), new HttpHeaders(), servlet(request),
                violations);
    }

    @Override
    protected ResponseEntity<Object> handleHttpMessageNotReadable(HttpMessageNotReadableException ex,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        ProblemResponse.Violation violation = switch (ex.getMostSpecificCause()) {
            case UnrecognizedPropertyException unknown -> new ProblemResponse.Violation(unknown.getPropertyName(),
                    "UNKNOWN_FIELD", "Ce champ n'est pas reconnu.");
            case JacksonException invalid when fieldName(invalid) != null -> new ProblemResponse.Violation(
                    fieldName(invalid), "INVALID_VALUE", "La valeur de ce champ n'a pas le type attendu.");
            default -> new ProblemResponse.Violation("body", "MALFORMED_BODY",
                    "Le corps de la requête est absent ou n'est pas un JSON valide.");
        };
        return problems.entity(ApiError.VALIDATION_ERROR, status.value(), new HttpHeaders(), servlet(request),
                List.of(violation));
    }

    @Override
    protected ResponseEntity<Object> handleNoResourceFoundException(NoResourceFoundException ex, HttpHeaders headers,
            HttpStatusCode status, WebRequest request) {
        return problems.entity(ApiError.RESOURCE_NOT_FOUND, servlet(request));
    }

    @Override
    protected ResponseEntity<Object> handleExceptionInternal(Exception ex, Object body, HttpHeaders headers,
            HttpStatusCode statusCode, WebRequest request) {
        int status = statusCode.value();
        ApiError error = status == 404 ? ApiError.RESOURCE_NOT_FOUND
                : status >= 500 ? ApiError.INTERNAL_ERROR : ApiError.VALIDATION_ERROR;
        if (status >= 500) {
            log.error("Framework error while handling {}", servlet(request).getRequestURI(), ex);
        }
        return problems.entity(error, status, headers, servlet(request), null);
    }

    private static HttpServletRequest servlet(WebRequest request) {
        return ((ServletWebRequest) request).getRequest();
    }

    private static String fieldName(JacksonException exception) {
        List<JacksonException.Reference> path = exception.getPath();
        return path.isEmpty() ? null : path.getLast().getPropertyName();
    }

    static String violationCode(String constraint) {
        if (constraint == null || constraint.isBlank()) {
            return "INVALID_VALUE";
        }
        return constraint.replaceAll("([a-z0-9])([A-Z])", "$1_$2").toUpperCase(Locale.ROOT);
    }
}
