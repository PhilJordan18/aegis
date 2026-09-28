package ca.aegis.control.shared.web;

import java.net.URI;
import java.util.Locale;

import org.springframework.http.HttpStatus;

/** Stable error codes of the REST contract (document 09, section 21). */
public enum ApiError {

    VALIDATION_ERROR(HttpStatus.BAD_REQUEST, "Requête invalide",
            "La requête ne respecte pas le format attendu."),
    AUTH_INVALID_CREDENTIALS(HttpStatus.UNAUTHORIZED, "Connexion refusée",
            "L'adresse courriel ou le mot de passe est invalide."),
    AUTH_TOKEN_INVALID(HttpStatus.UNAUTHORIZED, "Jeton invalide",
            "Le jeton d'accès est absent, invalide ou n'est plus accepté. Reconnectez-vous."),
    AUTH_TOKEN_EXPIRED(HttpStatus.UNAUTHORIZED, "Jeton expiré",
            "Le jeton d'accès a expiré. Reconnectez-vous."),
    FORBIDDEN(HttpStatus.FORBIDDEN, "Accès refusé",
            "Votre rôle ne permet pas cette action."),
    ASSET_ACCESS_DENIED(HttpStatus.FORBIDDEN, "Niveau d'accès insuffisant",
            "Votre niveau d'accès ne permet pas d'utiliser cet actif."),
    RESOURCE_NOT_FOUND(HttpStatus.NOT_FOUND, "Ressource introuvable",
            "La ressource demandée est absente ou n'est pas visible."),
    RATE_LIMITED(HttpStatus.TOO_MANY_REQUESTS, "Trop de tentatives",
            "Trop de tentatives ont été reçues. Réessayez plus tard."),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "Erreur interne",
            "Une erreur inattendue est survenue. Communiquez l'identifiant de trace au support.");

    private final HttpStatus status;
    private final String title;
    private final String detail;

    ApiError(HttpStatus status, String title, String detail) {
        this.status = status;
        this.title = title;
        this.detail = detail;
    }

    public HttpStatus status() {
        return status;
    }

    public String title() {
        return title;
    }

    public String detail() {
        return detail;
    }

    public URI type() {
        return URI.create("https://aegis.local/problems/" + name().toLowerCase(Locale.ROOT).replace('_', '-'));
    }
}
