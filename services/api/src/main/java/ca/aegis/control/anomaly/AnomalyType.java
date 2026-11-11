package ca.aegis.control.anomaly;

/**
 * Types of {@code ck_anomalies_type} (document 08, section 4.9). Provisional rule D5 of the 11 November 2026 matrix
 * (#67): {@code AnomalyView.summary} is a fixed sentence chosen from the type, never built from stored details.
 */
enum AnomalyType {
    EXPECTED_ASSET_NOT_OBSERVED("L'actif attendu n'a pas été observé dans sa cellule."),
    UNEXPECTED_ASSET_OBSERVED("Un actif inattendu a été observé dans une cellule."),
    ASSET_PRESENT_WITH_ACTIVE_LOAN("Un actif en prêt actif a été observé dans sa cellule."),
    DOOR_NOT_CLOSED_BEFORE_EXPIRY("La porte n'a pas été refermée avant l'échéance de l'opération."),
    COMMAND_REJECTED("Le casier a refusé la commande de l'opération."),
    DEVICE_OFFLINE_DURING_OPERATION("Le casier s'est déconnecté pendant l'opération."),
    INCONSISTENT_PHYSICAL_STATE("Les observations physiques du casier sont incohérentes.");

    private final String summary;

    AnomalyType(String summary) {
        this.summary = summary;
    }

    String summary() {
        return summary;
    }
}
