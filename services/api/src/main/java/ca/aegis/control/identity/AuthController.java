package ca.aegis.control.identity;

import java.time.Clock;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import ca.aegis.control.shared.web.SensitiveRequestValidator;

@RestController
@RequestMapping("/api/v1/auth")
class AuthController {

    private final AuthenticationService authentication;
    private final BrowserSessions browserSessions;
    private final BrowserSessionProperties browserSessionProperties;
    private final SensitiveRequestValidator validator;
    private final Clock clock;

    AuthController(AuthenticationService authentication, BrowserSessions browserSessions,
            BrowserSessionProperties browserSessionProperties, SensitiveRequestValidator validator, Clock clock) {
        this.authentication = authentication;
        this.browserSessions = browserSessions;
        this.browserSessionProperties = browserSessionProperties;
        this.validator = validator;
        this.clock = clock;
    }

    /**
     * The client address is the TCP peer; forwarding headers are not trusted without a configured proxy. With
     * {@code browserSession}, the Origin is checked before the credentials, so a refused origin learns nothing.
     */
    @PostMapping(path = "/login", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<LoginResponse> login(@RequestBody LoginRequest request, HttpServletRequest http) {
        validator.validate(request);
        if (request.wantsBrowserSession()) {
            requireAllowedOrigin(http);
        }
        AuthenticationService.SignedIn signedIn = authentication.login(request, http.getRemoteAddr());
        ResponseEntity.BodyBuilder response = ResponseEntity.ok();
        signedIn.browserSession().ifPresent(started -> response.header(HttpHeaders.SET_COOKIE,
                BrowserSessions.cookie(started, clock).toString()));
        return response.body(signedIn.response());
    }

    /** Always the caller's own profile: the account comes from the token subject, never from a parameter. */
    @GetMapping("/me")
    UserProfile me(@AuthenticationPrincipal CurrentAccount account) {
        return UserProfile.of(account);
    }

    /** ADR-016: a new in-memory access token for a reloaded Manager page, from its browser session cookie. */
    @PostMapping("/session/refresh")
    LoginResponse refresh(HttpServletRequest http) {
        requireAllowedOrigin(http);
        return browserSessions.refresh(sessionCookie(http)).orElseThrow(BrowserSessionInvalidException::new);
    }

    /** ADR-016: explicit sign-out. Idempotent; the cookie is cleared whether or not a session was still open. */
    @PostMapping("/session/revoke")
    ResponseEntity<Void> revoke(HttpServletRequest http) {
        requireAllowedOrigin(http);
        browserSessions.signOut(sessionCookie(http));
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, BrowserSessions.cleared().toString())
                .build();
    }

    /**
     * Read here rather than bound as a handler argument: Spring logs handler arguments at TRACE, and the cookie value
     * is a credential.
     */
    private static String sessionCookie(HttpServletRequest http) {
        Cookie[] cookies = http.getCookies();
        if (cookies == null) {
            return null;
        }
        for (Cookie cookie : cookies) {
            if (BrowserSessions.COOKIE.equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
        return null;
    }

    private void requireAllowedOrigin(HttpServletRequest http) {
        if (!browserSessionProperties.allows(http.getHeader(HttpHeaders.ORIGIN))) {
            throw new OriginNotAllowedException();
        }
    }
}
