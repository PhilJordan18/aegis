package ca.aegis.control.identity;

import java.io.IOException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpHeaders;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authorization.AuthorizationDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.jwt.JwtValidationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;

import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.Problems;

/** Writes the 401, 403 and 404 responses of the security filter chains in the contract error format. */
final class SecurityProblemHandlers implements AuthenticationEntryPoint, AccessDeniedHandler {

    private final Problems problems;

    SecurityProblemHandlers(Problems problems) {
        this.problems = problems;
    }

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response, AuthenticationException failure)
            throws IOException {
        boolean tokenPresented = failure instanceof OAuth2AuthenticationException;
        response.setHeader(HttpHeaders.WWW_AUTHENTICATE, tokenPresented ? "Bearer error=\"invalid_token\"" : "Bearer");
        problems.write(request, response, onlyExpired(failure) ? ApiError.AUTH_TOKEN_EXPIRED : ApiError.AUTH_TOKEN_INVALID);
    }

    /** 403 for a documented route the role may not call; 404 for a route missing from {@link ApiRoutes}. */
    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response, AccessDeniedException denied)
            throws IOException {
        boolean unlisted = denied instanceof AuthorizationDeniedException authorization
                && authorization.getAuthorizationResult() instanceof ApiRoutes.UnlistedRoute;
        problems.write(request, response, unlisted ? ApiError.RESOURCE_NOT_FOUND : ApiError.FORBIDDEN);
    }

    /** A token is reported as expired only when it is authentic and expiry is its sole defect. */
    private static boolean onlyExpired(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof JwtValidationException invalid) {
                return !invalid.getErrors().isEmpty() && invalid.getErrors().stream()
                        .map(OAuth2Error::getDescription)
                        .allMatch(AccessTokens.Validator.EXPIRED::equals);
            }
        }
        return false;
    }
}
