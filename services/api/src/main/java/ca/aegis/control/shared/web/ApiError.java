package ca.aegis.control.shared.web;

import java.net.URI;
import java.util.Locale;

import org.springframework.http.HttpStatus;

/**
 * Stable error codes of the REST contract (document 09, section 21).
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
    /** Unknown asset of the technician catalog (document 09, section 11.2). */
    ASSET_NOT_FOUND(HttpStatus.NOT_FOUND, "Actif introuvable",
            "L'actif demandé est absent du catalogue."),
    /** The locker exists but has no active operating schedule (document 09, section 13.1). */
    OPERATING_SCHEDULE_NOT_CONFIGURED(HttpStatus.NOT_FOUND, "Horaire non configuré",
            "Aucun horaire d'exploitation actif n'est configuré pour ce locker."),
    /** The technician holds no ACTIVE reservation (document 09, section 14.2). */
    ACTIVE_RESERVATION_NOT_FOUND(HttpStatus.NOT_FOUND, "Aucune réservation active",
            "Vous ne possédez aucune réservation active."),
    ASSET_ALREADY_RESERVED(HttpStatus.CONFLICT, "Actif déjà réservé",
            "L'actif possède déjà une réservation active."),
    USER_ALREADY_HAS_ACTIVE_RESERVATION(HttpStatus.CONFLICT, "Réservation active existante",
            "Vous possédez déjà une réservation active."),
    ASSET_HAS_OPEN_LOAN(HttpStatus.CONFLICT, "Prêt ouvert existant",
            "L'actif fait l'objet d'un prêt non terminé."),
    /** A non-terminal locker operation concerns the asset (document 09, sections 12.2 and 12.3). */
    ASSET_OPERATION_IN_PROGRESS(HttpStatus.CONFLICT, "Opération en cours",
            "Une opération physique non terminée concerne l'actif."),
    ASSET_NOT_READY(HttpStatus.UNPROCESSABLE_CONTENT, "Actif non prêt",
            "L'actif ne peut pas être réservé dans son état actuel."),
    OUTSIDE_OPERATING_HOURS(HttpStatus.UNPROCESSABLE_CONTENT, "Hors des heures d'exploitation",
            "L'action n'est possible que pendant une plage d'exploitation ouverte."),
    RESERVATION_END_AFTER_CLOSING(HttpStatus.UNPROCESSABLE_CONTENT, "Échéance trop tardive",
            "La fin de la réservation dépasse la fermeture de la plage d'exploitation courante."),
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
