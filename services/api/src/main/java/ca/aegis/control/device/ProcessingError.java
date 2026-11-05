package ca.aegis.control.device;

/** The controlled {@code processingError} values of a rejected device message (document 10, section 21). */
public enum ProcessingError {
    DEVICE_UNKNOWN,
    DEVICE_DISABLED,
    TOPIC_NOT_AUTHORIZED,
    TOPIC_PAYLOAD_LOCKER_MISMATCH,
    PAYLOAD_TOO_LARGE,
    INVALID_JSON,
    /**
     * Also used, for want of a more precise code in section 21, when a field is present with a value the contract
     * does not allow (an unknown controlled value, an over-long {@code detail}, a field the type forbids).
     */
    REQUIRED_FIELD_MISSING,
    UNSUPPORTED_SCHEMA,
    MESSAGE_TYPE_NOT_ALLOWED_ON_TOPIC,
    INVALID_UUID,
    TIMESTAMP_INVALID,
    TIMESTAMP_OUT_OF_RANGE,
    OPERATION_NOT_FOUND,
    OPERATION_LOCKER_MISMATCH,
    OPERATION_COMPARTMENT_MISMATCH,
    COMMAND_CORRELATION_INVALID,
    TERMINAL_OPERATION_EVENT_IGNORED
}
