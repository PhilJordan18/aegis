package ca.aegis.control.command;

/**
 * The transport half of the outbox. An implementation publishes at QoS 1 and never retained (document 10, section
 * 7), and returns only once the broker has accepted the message. A failure says that acceptance was not confirmed,
 * not that the message was lost: the dispatcher may therefore publish the same command again.
 */
public interface CommandPublisher {

    void publish(String topic, byte[] payload) throws CommandPublicationException;

    class CommandPublicationException extends Exception {

        private final boolean mayHaveBeenPublished;

        /**
         * @param reason a bounded, machine-readable cause, safe to store in {@code command_outbox.last_error}
         * @param mayHaveBeenPublished false only when the message certainly never left this process
         */
        public CommandPublicationException(String reason, boolean mayHaveBeenPublished, Throwable cause) {
            super(reason, cause);
            this.mayHaveBeenPublished = mayHaveBeenPublished;
        }

        public boolean mayHaveBeenPublished() {
            return mayHaveBeenPublished;
        }
    }
}
