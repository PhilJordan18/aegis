package ca.aegis.control.identity;

import java.nio.charset.StandardCharsets;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;
import ca.aegis.control.shared.web.InvalidRequestException;

@Service
class OwnPasswordChange {
    private final AccountRepository accounts;
    private final PasswordChanges passwords;
    private final PasswordEncoder encoder;
    private final PasswordChangeAttempts attempts;
    private final DemoAccountProperties demo;

    OwnPasswordChange(AccountRepository accounts, PasswordChanges passwords, PasswordEncoder encoder,
            PasswordChangeAttempts attempts, DemoAccountProperties demo) {
        this.accounts = accounts;
        this.passwords = passwords;
        this.encoder = encoder;
        this.attempts = attempts;
        this.demo = demo;
    }

    @Transactional
    void change(CurrentAccount caller, ChangePasswordRequest request) {
        if (demo.enabled() && demo.rotatePasswords()) {
            throw new Refused(ApiError.PASSWORD_CHANGE_UNAVAILABLE);
        }
        if (request.newPassword().getBytes(StandardCharsets.UTF_8).length < 12) {
            throw InvalidRequestException.of("newPassword", "MIN_UTF8_BYTES",
                    "Le nouveau mot de passe doit contenir au moins 12 octets.");
        }
        attempts.acquire(caller.id());
        // The version checked at authentication must still be current after waiting for this lock.
        Account current = accounts.lockById(caller.id())
                .filter(Account::canAuthenticate)
                .filter(account -> account.credentialVersion() == caller.credentialVersion())
                .orElseThrow(() -> new Refused(ApiError.AUTH_TOKEN_INVALID));
        if (!encoder.matches(request.currentPassword(), current.passwordHash())) {
            throw new Refused(ApiError.PASSWORD_CURRENT_INVALID);
        }
        if (!passwords.change(current.id(), request.newPassword(), current.id())) {
            throw new Refused(ApiError.PASSWORD_REUSED);
        }
    }

    static final class Refused extends ApiException {
        Refused(ApiError error) {
            super(error);
        }
    }
}
