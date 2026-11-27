package ca.aegis.control.identity;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import ca.aegis.control.shared.web.SensitiveRequestValidator;

@RestController
class PasswordController {
    private final OwnPasswordChange passwords;
    private final SensitiveRequestValidator validator;

    PasswordController(OwnPasswordChange passwords, SensitiveRequestValidator validator) {
        this.passwords = passwords;
        this.validator = validator;
    }

    @PostMapping(path = "/api/v1/auth/password", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<Void> change(@AuthenticationPrincipal CurrentAccount account,
            @RequestBody ChangePasswordRequest request) {
        validator.validate(request);
        passwords.change(account, request);
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, BrowserSessions.cleared().toString()).build();
    }
}
