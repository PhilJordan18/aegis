package ca.aegis.control.identity;

import static org.springframework.http.HttpMethod.GET;
import static org.springframework.http.HttpMethod.POST;
import static org.springframework.http.HttpMethod.PUT;

import java.util.List;

import org.springframework.http.HttpMethod;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.OrRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;

/**
 * Every route of document 09, section 9, with the callers allowed on it. HTTP security grants access only through
 * this table: an endpoint that is not listed stays unreachable, even for an authenticated caller, until it is
 * documented and added here.
 */
final class ApiRoutes {

    enum Access {
        PUBLIC,
        /** Either role; document 09 lists the profile and the locker status for both. */
        ADMIN_OR_TECHNICIAN,
        TECHNICIAN,
        ADMIN
    }

    record Route(HttpMethod method, String path, Access access) {

        RequestMatcher matcher() {
            return PathPatternRequestMatcher.pathPattern(method, path);
        }
    }

    static final List<Route> DOCUMENTED = List.of(
            // 9.1 Public and profile
            route(GET, "/system/health", Access.PUBLIC),
            route(POST, "/auth/login", Access.PUBLIC),
            route(GET, "/auth/me", Access.ADMIN_OR_TECHNICIAN),
            // 9.2 Technician; sections 5 and 16.1 also open the locker status to administrators
            route(GET, "/assets", Access.TECHNICIAN),
            route(GET, "/assets/{assetId}", Access.TECHNICIAN),
            route(POST, "/reservations", Access.TECHNICIAN),
            route(GET, "/me/reservation", Access.TECHNICIAN),
            route(GET, "/reservations/{reservationId}", Access.TECHNICIAN),
            route(POST, "/reservations/{reservationId}/cancel", Access.TECHNICIAN),
            route(POST, "/reservations/{reservationId}/checkout", Access.TECHNICIAN),
            route(GET, "/me/loan", Access.TECHNICIAN),
            route(GET, "/loans/{loanId}", Access.TECHNICIAN),
            route(POST, "/loans/{loanId}/return", Access.TECHNICIAN),
            route(POST, "/locker-operations/{operationId}/authorize-local", Access.TECHNICIAN),
            route(GET, "/locker-operations/{operationId}", Access.TECHNICIAN),
            route(GET, "/lockers/{lockerId}/status", Access.ADMIN_OR_TECHNICIAN),
            // 9.3 Administration
            route(GET, "/admin/asset-models", Access.ADMIN),
            route(POST, "/admin/asset-models", Access.ADMIN),
            route(GET, "/admin/asset-models/{modelId}", Access.ADMIN),
            route(PUT, "/admin/asset-models/{modelId}", Access.ADMIN),
            route(POST, "/admin/asset-models/{modelId}/archive", Access.ADMIN),
            route(GET, "/admin/assets", Access.ADMIN),
            route(POST, "/admin/assets", Access.ADMIN),
            route(GET, "/admin/assets/{assetId}", Access.ADMIN),
            route(PUT, "/admin/assets/{assetId}", Access.ADMIN),
            route(POST, "/admin/assets/{assetId}/archive", Access.ADMIN),
            route(POST, "/admin/assets/{assetId}/identifiers", Access.ADMIN),
            route(POST, "/admin/assets/{assetId}/identifiers/{identifierId}/revoke", Access.ADMIN),
            route(PUT, "/admin/assets/{assetId}/placement", Access.ADMIN),
            route(GET, "/admin/lockers", Access.ADMIN),
            route(GET, "/admin/lockers/{lockerId}/operating-schedule", Access.ADMIN),
            route(PUT, "/admin/lockers/{lockerId}/operating-schedule", Access.ADMIN),
            route(GET, "/admin/reservations", Access.ADMIN),
            route(GET, "/admin/reservations/{reservationId}", Access.ADMIN),
            route(GET, "/admin/loans", Access.ADMIN),
            route(GET, "/admin/loans/{loanId}", Access.ADMIN),
            route(GET, "/admin/locker-operations", Access.ADMIN),
            route(GET, "/admin/locker-operations/{operationId}", Access.ADMIN),
            route(GET, "/admin/anomalies", Access.ADMIN),
            route(GET, "/admin/anomalies/{anomalyId}", Access.ADMIN),
            route(POST, "/admin/anomalies/{anomalyId}/acknowledge", Access.ADMIN),
            route(GET, "/admin/audit-events", Access.ADMIN));

    /** Decision for a request that matches no documented route; answered 404 so the endpoint stays invisible. */
    static final class UnlistedRoute extends AuthorizationDecision {

        UnlistedRoute() {
            super(false);
        }
    }

    static final AuthorizationManager<RequestAuthorizationContext> UNLISTED =
            (authentication, context) -> new UnlistedRoute();

    private ApiRoutes() {
    }

    static RequestMatcher publicRoutes() {
        return new OrRequestMatcher(DOCUMENTED.stream()
                .filter(route -> route.access() == Access.PUBLIC)
                .map(Route::matcher)
                .toList());
    }

    private static Route route(HttpMethod method, String path, Access access) {
        return new Route(method, "/api/v1" + path, access);
    }
}
