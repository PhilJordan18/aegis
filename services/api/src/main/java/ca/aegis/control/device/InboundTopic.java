package ca.aegis.control.device;

import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** A topic the backend reads: {@code aegis/v1/lockers/{lockerId}/events|status}, lockerId in canonical lowercase. */
record InboundTopic(String value, UUID lockerId, Channel channel) {

    static final String EVENTS_FILTER = "aegis/v1/lockers/+/events";
    static final String STATUS_FILTER = "aegis/v1/lockers/+/status";

    private static final Pattern TOPIC = Pattern.compile(
            "aegis/v1/lockers/(" + Uuids.CANONICAL + ")/(events|status)");

    static Optional<InboundTopic> parse(String topic) {
        Matcher matcher = TOPIC.matcher(topic);
        if (!matcher.matches()) {
            return Optional.empty();
        }
        Channel channel = matcher.group(2).equals("events") ? Channel.EVENTS : Channel.STATUS;
        return Optional.of(new InboundTopic(topic, UUID.fromString(matcher.group(1)), channel));
    }
}
