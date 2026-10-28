package ca.aegis.control.locker;

import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Body of {@code PUT /admin/lockers/{lockerId}/operating-schedule} (document 09, section 13.2). Bean Validation
 * checks each field alone; {@link OperatingScheduleRules} then checks the rules that combine fields.
 */
record OperatingScheduleRequest(
        @NotBlank(message = "Le fuseau horaire est requis.")
        String timeZone,

        @NotNull(message = "Les sept jours sont requis.")
        @Size(min = 7, max = 7, message = "L'horaire contient exactement sept jours.")
        List<@NotNull(message = "Le jour est requis.") @Valid OperatingWindowRequest> windows) {
}
