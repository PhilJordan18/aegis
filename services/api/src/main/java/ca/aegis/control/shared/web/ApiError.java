package ca.aegis.control.shared.web;

import java.net.URI;
import java.util.Locale;

import org.springframework.http.HttpStatus;

/**
 * Stable error codes of the REST contract (document 09, section 21). The identifier and compartment codes of CAT-02
 * are listed there as proposed until the contract is approved.
 */
public enum ApiError {

    VALIDATION_ERROR(HttpStatus.BAD_REQUEST, "Requête invalide",
            "La requête ne respecte pas le format attendu."),
    IDEMPOTENCY_KEY_REQUIRED(HttpStatus.BAD_REQUEST, "Clé d'idempotence requise",
            "Cette action exige l'en-tête Idempotency-Key."),
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
    ASSET_MODEL_IN_USE(HttpStatus.CONFLICT, "Modèle utilisé",
            "Le modèle est encore utilisé par un actif non archivé."),
    ASSET_MODEL_NAME_ALREADY_EXISTS(HttpStatus.CONFLICT, "Nom de modèle déjà utilisé",
            "Un modèle actif porte déjà ce nom."),
    ASSET_MODEL_ARCHIVED(HttpStatus.CONFLICT, "Modèle archivé",
            "Un modèle archivé ne peut plus être modifié."),
    ASSET_CODE_ALREADY_EXISTS(HttpStatus.CONFLICT, "Code d'actif déjà utilisé",
            "Un actif porte déjà ce code."),
    ASSET_SERIAL_NUMBER_ALREADY_EXISTS(HttpStatus.CONFLICT, "Numéro de série déjà utilisé",
            "Un actif porte déjà ce numéro de série."),
    ASSET_ARCHIVED(HttpStatus.CONFLICT, "Actif archivé",
            "Un actif archivé ne peut plus être modifié."),
    IDENTIFIER_ALREADY_ASSIGNED(HttpStatus.CONFLICT, "Identifiant déjà attribué",
            "Cet identifiant est déjà actif sur un actif."),
    IDENTIFIER_TYPE_UNSUPPORTED(HttpStatus.UNPROCESSABLE_CONTENT, "Type d'identifiant non pris en charge",
            "Les types d'identifiant acceptés sont RFID_UHF, NFC et QR."),
    COMPARTMENT_DISABLED(HttpStatus.CONFLICT, "Compartiment désactivé",
            "Un compartiment désactivé ne peut pas recevoir d'actif."),
    COMPARTMENT_ALREADY_OCCUPIED(HttpStatus.CONFLICT, "Compartiment déjà attribué",
            "Un autre actif est déjà placé dans ce compartiment."),
    IDEMPOTENCY_KEY_REUSED(HttpStatus.CONFLICT, "Clé d'idempotence réutilisée",
            "Cette clé d'idempotence a déjà servi pour une autre requête."),
    IDEMPOTENCY_REQUEST_IN_PROGRESS(HttpStatus.CONFLICT, "Requête déjà en cours",
            "Une requête portant la même clé d'idempotence est encore en cours. Réessayez plus tard."),
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
