package ca.aegis.control.identity;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.MediaType;
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
    private final SensitiveRequestValidator validator;

    AuthController(AuthenticationService authentication, SensitiveRequestValidator validator) {
        this.authentication = authentication;
        this.validator = validator;
    }

    /** The client address is the TCP peer; forwarding headers are not trusted without a configured proxy. */
    @PostMapping(path = "/login", consumes = MediaType.APPLICATION_JSON_VALUE)
    LoginResponse login(@RequestBody LoginRequest request, HttpServletRequest http) {
        validator.validate(request);
        return authentication.login(request, http.getRemoteAddr());
    }

    /** Always the caller's own profile: the account comes from the token subject, never from a parameter. */
    @GetMapping("/me")
    UserProfile me(@AuthenticationPrincipal CurrentAccount account) {
        return UserProfile.of(account);
    }
}
