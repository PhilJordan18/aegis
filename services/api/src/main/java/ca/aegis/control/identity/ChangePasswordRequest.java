package ca.aegis.control.identity;

import jakarta.validation.constraints.NotEmpty;

/** Secrets are never normalized or included in diagnostic string representations. */
record ChangePasswordRequest(
        @NotEmpty(message = "Le mot de passe actuel est requis.")
        @MaxUtf8Bytes(value = 72, message = "Le mot de passe actuel dépasse 72 octets.")
        String currentPassword,
        @NotEmpty(message = "Le nouveau mot de passe est requis.")
        @MaxUtf8Bytes(value = 72, message = "Le nouveau mot de passe dépasse 72 octets.")
        String newPassword) {
    @Override
    public String toString() {
        return "ChangePasswordRequest[<redacted>]";
    }
}
