package ca.aegis.control.command;

/**
 * The authorizing transaction asked for a command that document 06, section 7 forbids. Thrown inside that
 * transaction, it rolls the business decision back with the command it refused.
 */
public class CommandRefusedException extends RuntimeException {

    public enum Reason {
        OPERATION_NOT_FOUND,
        OPERATION_NOT_AUTHORIZED,
        LOCAL_CHALLENGE_NOT_CONSUMED,
        OPERATION_EXPIRED,
        COMMAND_ALREADY_ISSUED
    }

    private final Reason reason;

    CommandRefusedException(Reason reason) {
        super(reason.name());
        this.reason = reason;
    }

    public Reason reason() {
        return reason;
    }
}
