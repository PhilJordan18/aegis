package ca.aegis.control.asset;

import java.time.Instant;

/** Calibration requirement, due date and derived state of an asset (document 09, section 8.2). */
public record CalibrationView(boolean required, Instant dueAt, CalibrationStatus status) {
}
