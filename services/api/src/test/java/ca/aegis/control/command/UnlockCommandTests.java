package ca.aegis.control.command;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Document 10, sections 3.2, 3.3, 5, 8.2 and 9: the serialized command and nothing else. */
class UnlockCommandTests {

    private static final UUID MESSAGE = UUID.fromString("55c71961-21a3-4b2e-8b92-7f237e881a20");
    private static final UUID OPERATION = UUID.fromString("2f38d3b6-c18f-4a74-aa9a-2d574286013f");
    private static final UUID LOCKER = UUID.fromString("d46a74ae-39dc-460b-8af0-38fc791b376a");
    private static final UUID COMPARTMENT = UUID.fromString("1ae77ae3-8490-4f09-9412-a7816b77bff9");

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void serializesTheSectionNineExampleExactly() {
        UnlockCommand command = new UnlockCommand(MESSAGE, OPERATION, LOCKER, COMPARTMENT,
                Instant.parse("2026-09-16T14:31:00Z"), Instant.parse("2026-09-16T14:33:00Z"), "3.0");

        assertThat(jsonMapper.writeValueAsString(command.payload())).isEqualTo("""
                {"schemaVersion":"3.0","messageId":"55c71961-21a3-4b2e-8b92-7f237e881a20",\
                "type":"UNLOCK_COMPARTMENT","operationId":"2f38d3b6-c18f-4a74-aa9a-2d574286013f",\
                "lockerId":"d46a74ae-39dc-460b-8af0-38fc791b376a",\
                "compartmentId":"1ae77ae3-8490-4f09-9412-a7816b77bff9",\
                "issuedAt":"2026-09-16T14:31:00Z","expiresAt":"2026-09-16T14:33:00Z"}""");
        assertThat(command.topic()).isEqualTo("aegis/v1/lockers/d46a74ae-39dc-460b-8af0-38fc791b376a/commands");
    }

    @Test
    void carriesOnlyTheEightContractFieldsInSchemaThree() {
        UnlockCommand command = new UnlockCommand(MESSAGE, OPERATION, LOCKER, COMPARTMENT,
                Instant.parse("2026-09-16T14:31:00Z"), Instant.parse("2026-09-16T14:33:00Z"),
                UnlockCommand.SCHEMA_VERSION);

        JsonNode payload = jsonMapper.readTree(jsonMapper.writeValueAsString(command.payload()));

        assertThat(payload.propertyNames()).containsExactly("schemaVersion", "messageId", "type", "operationId",
                "lockerId", "compartmentId", "issuedAt", "expiresAt");
        assertThat(payload.get("schemaVersion").asString()).isEqualTo("3.0");
        assertThat(payload.get("type").asString()).isEqualTo("UNLOCK_COMPARTMENT");
    }

    @Test
    void writesUtcInstantsWithSecondsAndAtMostThreeFractionDigits() {
        assertThat(UnlockCommand.format(Instant.parse("2026-09-16T14:31:00Z"))).isEqualTo("2026-09-16T14:31:00Z");
        assertThat(UnlockCommand.format(Instant.parse("2026-09-16T14:31:00.120Z")))
                .isEqualTo("2026-09-16T14:31:00.120Z");
        assertThat(UnlockCommand.format(Instant.parse("2026-09-16T14:31:00.123456789Z")))
                .isEqualTo("2026-09-16T14:31:00.123Z");
    }

    @Test
    void refusesACommandThatExpiresWhenOrBeforeItIsIssued() {
        Instant at = Instant.parse("2026-09-16T14:31:00Z");

        assertThatThrownBy(() -> new UnlockCommand(MESSAGE, OPERATION, LOCKER, COMPARTMENT, at, at, "3.0"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new UnlockCommand(MESSAGE, OPERATION, LOCKER, COMPARTMENT, at, at.minusSeconds(1),
                "3.0")).isInstanceOf(IllegalArgumentException.class);
    }
}
