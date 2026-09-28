package ca.aegis.control.identity;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

/** {@code POST /api/v1/auth/login} body. The email is normalized before validation; the password never is. */
record LoginRequest(
        @NotBlank(message = "L'adresse courriel est requise.")
        @Size(max = EmailAddresses.MAX_LENGTH, message = "L'adresse courriel dépasse 320 caractères.")
        @Email(message = "L'adresse courriel n'est pas valide.")
        String email,

        @NotEmpty(message = "Le mot de passe est requis.")
        @MaxUtf8Bytes(value = 72, message = "Le mot de passe dépasse 72 octets.")
        String password) {

    LoginRequest {
        email = EmailAddresses.normalize(email);
    }

    @Override
    public String toString() {
        return "LoginRequest[email=%s]".formatted(email);
    }
}
