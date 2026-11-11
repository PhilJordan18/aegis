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
    /**
     * Document 09, section 22.2; rule D10 approved on 11 November 2026 (#67): a cursor that is
     * malformed or was issued for other filters.
     */
    INVALID_CURSOR(HttpStatus.BAD_REQUEST, "Curseur invalide",
            "Le curseur ne correspond pas à cette recherche. Reprenez la consultation depuis la première page."),
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
    /** The technician holds no open loan, ACTIVE or RETURN_PENDING (document 09, section 15.3). */
    ACTIVE_LOAN_NOT_FOUND(HttpStatus.NOT_FOUND, "Aucun prêt en cours",
            "Vous ne détenez aucun prêt en cours."),
    ASSET_ALREADY_RESERVED(HttpStatus.CONFLICT, "Actif déjà réservé",
            "L'actif possède déjà une réservation active."),
    USER_ALREADY_HAS_ACTIVE_RESERVATION(HttpStatus.CONFLICT, "Réservation active existante",
            "Vous possédez déjà une réservation active."),
    ASSET_HAS_OPEN_LOAN(HttpStatus.CONFLICT, "Prêt ouvert existant",
            "L'actif fait l'objet d'un prêt non terminé."),
    /** A non-terminal locker operation concerns the asset (document 09, sections 12.2 and 12.3). */
    ASSET_OPERATION_IN_PROGRESS(HttpStatus.CONFLICT, "Opération en cours",
            "Une opération physique non terminée concerne l'actif."),
    /** The reservation is not in a state that admits a cancellation (document 09, section 14.4). */
    RESERVATION_NOT_CANCELLABLE(HttpStatus.CONFLICT, "Réservation non annulable",
            "La réservation ne peut plus être annulée dans son état actuel."),
    /** The loan is not ACTIVE, so no return attempt can be prepared (document 09, sections 15.2 and 21). */
    LOAN_NOT_RETURNABLE(HttpStatus.CONFLICT, "Prêt non retournable",
            "Ce prêt ne peut pas faire l'objet d'un retour dans son état actuel."),
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
    /** Document 09, section 18.2: a resolved anomaly is never acknowledged again. */
    ANOMALY_ALREADY_RESOLVED(HttpStatus.CONFLICT, "Anomalie déjà résolue",
            "Cette anomalie est déjà résolue par une preuve physique."),
    /**
     * Document 09, section 18.2; rule D6 approved on 11 November 2026 (#67): an anomaly already
     * acknowledged keeps its first note.
     */
    ANOMALY_NOT_ACKNOWLEDGEABLE(HttpStatus.CONFLICT, "Anomalie non reconnaissable",
            "Cette anomalie a déjà été reconnue; sa note n'est pas remplacée."),
    /** Document 06, section 6.1: another physical operation of the locker is not terminal. */
    LOCKER_OPERATION_IN_PROGRESS(HttpStatus.CONFLICT, "Locker déjà engagé",
            "Une autre opération physique est en cours sur ce locker. Réessayez lorsqu'elle sera terminée."),
    /** Document 06, section 6.1: a door, a lock or a cell incompatible with an opening. */
    COMPARTMENT_STATE_UNSAFE(HttpStatus.CONFLICT, "Compartiment dans un état incompatible",
            "La porte, la serrure ou la cellule du compartiment ne permet pas cette opération."),
    IDEMPOTENCY_KEY_REUSED(HttpStatus.CONFLICT, "Clé d'idempotence réutilisée",
            "Cette clé d'idempotence a déjà servi pour une autre requête."),
    IDEMPOTENCY_REQUEST_IN_PROGRESS(HttpStatus.CONFLICT, "Requête déjà en cours",
            "Une requête portant la même clé d'idempotence est encore en cours. Réessayez plus tard."),
    /** Document 06, section 6.1: the current physical proof is not enough to open. */
    PHYSICAL_STATE_UNKNOWN(HttpStatus.UNPROCESSABLE_CONTENT, "État physique inconnu",
            "La preuve physique courante est insuffisante pour cette opération."),
    RATE_LIMITED(HttpStatus.TOO_MANY_REQUESTS, "Trop de tentatives",
            "Trop de tentatives ont été reçues. Réessayez plus tard."),
    LOCKER_OFFLINE(HttpStatus.SERVICE_UNAVAILABLE, "Locker indisponible",
            "Le locker est temporairement indisponible. Réessayez plus tard."),
    DEVICE_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "Cellule indisponible",
            "La cellule ou son lecteur est temporairement indisponible. Réessayez plus tard."),
    /** Document 09, section 15.5: the local proof codes of {@code authorize-local} and of preparations. */
    LOCAL_PROOF_MALFORMED(HttpStatus.BAD_REQUEST, "Preuve locale invalide",
            "Le code lu ne correspond pas au format attendu. Scannez de nouveau le QR du casier."),
    OPERATION_NOT_FOUND(HttpStatus.NOT_FOUND, "Opération introuvable",
            "Cette opération n'existe pas ou ne vous appartient pas."),
    LOCAL_PROOF_INVALID(HttpStatus.FORBIDDEN, "Code refusé",
            "Le code scanné ne correspond pas à celui du casier."),
    LOCAL_PROOF_NOT_DISPLAYED(HttpStatus.CONFLICT, "Code pas encore affiché",
            "Le casier n'a pas encore confirmé l'affichage du code. Réessayez dans un instant."),
    LOCAL_PROOF_CONTEXT_MISMATCH(HttpStatus.CONFLICT, "Code d'une autre opération",
            "Ce code appartient à une autre opération ou à un autre casier."),
    LOCAL_PROOF_ALREADY_USED(HttpStatus.CONFLICT, "Code déjà utilisé",
            "Ce code a déjà servi; aucune nouvelle ouverture n'est possible avec lui."),
    LOCAL_PROOF_INVALIDATED(HttpStatus.CONFLICT, "Code invalidé",
            "Ce code n'est plus valide. Préparez une nouvelle opération."),
    LOCAL_PROOF_EXPIRED(HttpStatus.GONE, "Code expiré",
            "Le délai de ce code est dépassé. Préparez une nouvelle opération."),
    LOCAL_PROOF_RATE_LIMITED(HttpStatus.TOO_MANY_REQUESTS, "Trop de préparations",
            "Trop d'opérations ont été préparées récemment sur ce casier. Réessayez plus tard."),
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
