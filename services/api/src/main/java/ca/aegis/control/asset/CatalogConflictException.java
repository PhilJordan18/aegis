package ca.aegis.control.asset;

import java.util.Map;
import java.util.Optional;

import org.postgresql.util.PSQLException;
import org.postgresql.util.ServerErrorMessage;
import org.springframework.dao.DataIntegrityViolationException;

import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;

/** A catalog mutation refused by a uniqueness rule, the lifecycle of an archived resource or an unsupported value. */
final class CatalogConflictException extends ApiException {

    /** The unique indexes that guard catalog identities, named as PostgreSQL reports them. */
    private static final Map<String, ApiError> UNIQUE_INDEXES = Map.of(
            "ux_asset_models_name_ci", ApiError.ASSET_MODEL_NAME_ALREADY_EXISTS,
            "ux_assets_code_ci", ApiError.ASSET_CODE_ALREADY_EXISTS,
            "ux_assets_serial_number", ApiError.ASSET_SERIAL_NUMBER_ALREADY_EXISTS,
            "ux_asset_identifiers_active_value", ApiError.IDENTIFIER_ALREADY_ASSIGNED);

    CatalogConflictException(ApiError error) {
        super(error);
    }

    /**
     * The stable error of a known unique index, or the original exception when the violation is not one of them:
     * an unexpected integrity failure must stay an internal error rather than become a misleading conflict.
     */
    static RuntimeException translate(DataIntegrityViolationException violation) {
        return constraintName(violation)
                .map(UNIQUE_INDEXES::get)
                .<RuntimeException>map(CatalogConflictException::new)
                .orElse(violation);
    }

    private static Optional<String> constraintName(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof PSQLException postgres) {
                ServerErrorMessage message = postgres.getServerErrorMessage();
                return Optional.ofNullable(message == null ? null : message.getConstraint());
            }
        }
        return Optional.empty();
    }
}
