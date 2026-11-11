package ca.aegis.control.anomaly;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import ca.aegis.control.shared.web.PlainText;

/**
 * Body of {@code POST /admin/anomalies/{anomalyId}/acknowledge} (document 09, section 18.2). The note is stored as
 * written; a note made only of spaces is refused, as {@code ck_anomalies_acknowledgement_note} would.
 */
record AcknowledgeAnomalyRequest(
        @NotBlank(message = "La note est requise.")
        @Size(max = 500, message = "La note dépasse 500 caractères.")
        @PlainText(multiline = true, message = "La note contient un caractère non autorisé.")
        String note) {
}
