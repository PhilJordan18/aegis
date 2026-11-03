package ca.aegis.control.reservation;

import java.util.List;

import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;

/** A reservation refused by a business rule; {@code reasons} carries the readiness reasons of an unready asset. */
final class ReservationRefusedException extends ApiException {

    private final List<String> reasons;

    ReservationRefusedException(ApiError error) {
        this(error, null);
    }

    ReservationRefusedException(ApiError error, List<String> reasons) {
        super(error);
        this.reasons = reasons == null ? null : List.copyOf(reasons);
    }

    @Override
    public List<String> reasons() {
        return reasons;
    }
}
