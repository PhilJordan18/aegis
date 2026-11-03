package ca.aegis.control.locker;

import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;

/** The locker exists but has no active schedule, which the Web editor shows differently from an unknown locker. */
final class OperatingScheduleNotConfiguredException extends ApiException {

    OperatingScheduleNotConfiguredException() {
        super(ApiError.OPERATING_SCHEDULE_NOT_CONFIGURED);
    }
}
