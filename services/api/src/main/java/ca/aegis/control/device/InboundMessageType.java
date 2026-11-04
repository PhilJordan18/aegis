package ca.aegis.control.device;

import java.util.Arrays;
import java.util.Optional;

/**
 * The hub message types of the topic matrix (document 10, section 20), which are also the values accepted by
 * {@code ck_inbound_messages_type} (document 08, section 4.8).
 */
enum InboundMessageType {
    HEARTBEAT(Channel.STATUS, Presence.FORBIDDEN, Presence.FORBIDDEN, true),
    DEVICE_AVAILABILITY(Channel.STATUS, Presence.FORBIDDEN, Presence.FORBIDDEN, true),
    DEVICE_RESTARTED(Channel.EVENTS, Presence.FORBIDDEN, Presence.FORBIDDEN, true),
    DEVICE_ERROR(Channel.EVENTS, Presence.OPTIONAL, Presence.OPTIONAL, true),
    COMMAND_ACKNOWLEDGED(Channel.EVENTS, Presence.REQUIRED, Presence.REQUIRED, false),
    COMMAND_REJECTED(Channel.EVENTS, Presence.REQUIRED, Presence.REQUIRED, false),
    DOOR_OPENED(Channel.EVENTS, Presence.OPTIONAL, Presence.REQUIRED, false),
    DOOR_CLOSED(Channel.EVENTS, Presence.OPTIONAL, Presence.REQUIRED, false),
    LOCK_UNLOCKED(Channel.EVENTS, Presence.OPTIONAL, Presence.REQUIRED, false),
    LOCK_LOCKED(Channel.EVENTS, Presence.OPTIONAL, Presence.REQUIRED, false),
    RFID_SCAN_COMPLETED(Channel.EVENTS, Presence.OPTIONAL, Presence.REQUIRED, false),
    ACCESS_CHALLENGE_DISPLAYED(Channel.EVENTS, Presence.REQUIRED, Presence.REQUIRED, false),
    DISPLAY_REJECTED(Channel.EVENTS, Presence.REQUIRED, Presence.REQUIRED, false);

    enum Presence {
        FORBIDDEN,
        OPTIONAL,
        REQUIRED
    }

    private final Channel channel;
    private final Presence operationId;
    private final Presence compartmentId;
    private final boolean technical;

    InboundMessageType(Channel channel, Presence operationId, Presence compartmentId, boolean technical) {
        this.channel = channel;
        this.operationId = operationId;
        this.compartmentId = compartmentId;
        this.technical = technical;
    }

    static Optional<InboundMessageType> of(String name) {
        return Arrays.stream(values()).filter(type -> type.name().equals(name)).findFirst();
    }

    Channel channel() {
        return channel;
    }

    Presence operationId() {
        return operationId;
    }

    Presence compartmentId() {
        return compartmentId;
    }

    /**
     * A technical fact of the hub, fully processed by the ingestion. The other types are operational: their
     * observations and transitions belong to the operation workflows, so this ingestion keeps them RECEIVED.
     */
    boolean technical() {
        return technical;
    }

    /** An acknowledgement whose row must reference a {@code command_outbox} message (ck_inbound_messages_command_correlation). */
    boolean commandCorrelated() {
        return this == COMMAND_ACKNOWLEDGED || this == COMMAND_REJECTED;
    }

    /** A display acknowledgement whose row must reference a {@code hub_display_outbox} message and an operation. */
    boolean displayCorrelated() {
        return this == ACCESS_CHALLENGE_DISPLAYED || this == DISPLAY_REJECTED;
    }

    boolean connectionScoped() {
        return this == HEARTBEAT || this == DEVICE_AVAILABILITY;
    }
}
