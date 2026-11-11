package ca.aegis.control.display;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import ca.aegis.control.display.DisplayKeyRing.InvalidDisplayKeysException;
import ca.aegis.control.display.DisplayKeyRing.Sealed;
import ca.aegis.control.display.DisplayPayloadException.Reason;

class DisplayKeyRingTests {

    private static final String K1 = key();
    private static final String K2 = key();
    private static final byte[] PLAINTEXT = "{\"token\":\"secret-test-token\"}".getBytes(StandardCharsets.UTF_8);
    private static final UUID ROW = UUID.randomUUID();
    private static final UUID LOCKER = UUID.randomUUID();
    private static final UUID OPERATION = UUID.randomUUID();

    private static String key() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }

    private static byte[] aad(long revision) {
        return DisplayAad.of(ROW, LOCKER, OPERATION, revision);
    }

    @Test
    void aSealedPayloadOpensOnlyWithItsKeyAndAssociatedData() {
        DisplayKeyRing ring = DisplayKeyRing.parse("k1:" + K1, "k1");
        Sealed sealed = ring.seal(PLAINTEXT, aad(7));

        assertThat(sealed.keyId()).isEqualTo("k1");
        assertThat(sealed.envelope()).hasSize(DisplayKeyRing.NONCE_BYTES + PLAINTEXT.length + 16);
        assertThat(new String(sealed.envelope(), StandardCharsets.ISO_8859_1)).doesNotContain("secret-test-token");
        assertThat(ring.open("k1", sealed.envelope(), aad(7))).isEqualTo(PLAINTEXT);
    }

    @Test
    void eachSealDrawsAFreshNonce() {
        DisplayKeyRing ring = DisplayKeyRing.parse("k1:" + K1, "k1");
        byte[] first = ring.seal(PLAINTEXT, aad(1)).envelope();
        byte[] second = ring.seal(PLAINTEXT, aad(1)).envelope();

        assertThat(java.util.Arrays.copyOf(first, 12)).isNotEqualTo(java.util.Arrays.copyOf(second, 12));
        assertThat(first).isNotEqualTo(second);
    }

    @Test
    void anyModifiedByteOrOtherRowIsRefused() {
        DisplayKeyRing ring = DisplayKeyRing.parse("k1:" + K1, "k1");
        byte[] envelope = ring.seal(PLAINTEXT, aad(7)).envelope();

        for (int index = 0; index < envelope.length; index++) {
            byte[] tampered = envelope.clone();
            tampered[index] ^= 0x01;
            assertThatThrownBy(() -> ring.open("k1", tampered, aad(7)))
                    .isInstanceOfSatisfying(DisplayPayloadException.class,
                            refused -> assertThat(refused.reason()).isEqualTo(Reason.AUTHENTICATION_FAILED));
        }
        assertThatThrownBy(() -> ring.open("k1", envelope, aad(8))).isInstanceOf(DisplayPayloadException.class);
        assertThatThrownBy(() -> ring.open("k1", envelope, DisplayAad.of(UUID.randomUUID(), LOCKER, OPERATION, 7)))
                .isInstanceOf(DisplayPayloadException.class);
        assertThatThrownBy(() -> ring.open("k1", envelope, DisplayAad.of(ROW, UUID.randomUUID(), OPERATION, 7)))
                .isInstanceOf(DisplayPayloadException.class);
        assertThatThrownBy(() -> ring.open("k1", envelope, DisplayAad.of(ROW, LOCKER, UUID.randomUUID(), 7)))
                .isInstanceOf(DisplayPayloadException.class);
        assertThatThrownBy(() -> ring.open("k1", java.util.Arrays.copyOf(envelope, 20), aad(7)))
                .isInstanceOf(DisplayPayloadException.class);
    }

    @Test
    void rotationKeepsOldRowsReadableUntilTheirKeyIsRemoved() {
        DisplayKeyRing before = DisplayKeyRing.parse("k1:" + K1, "k1");
        byte[] oldRow = before.seal(PLAINTEXT, aad(3)).envelope();

        DisplayKeyRing rotated = DisplayKeyRing.parse("k1:" + K1 + ",k2:" + K2, "k2");
        Sealed newRow = rotated.seal(PLAINTEXT, aad(4));
        assertThat(newRow.keyId()).isEqualTo("k2");
        assertThat(rotated.open("k1", oldRow, aad(3))).isEqualTo(PLAINTEXT);
        assertThat(rotated.open("k2", newRow.envelope(), aad(4))).isEqualTo(PLAINTEXT);

        DisplayKeyRing retired = DisplayKeyRing.parse("k2:" + K2, "k2");
        assertThatThrownBy(() -> retired.open("k1", oldRow, aad(3)))
                .isInstanceOfSatisfying(DisplayPayloadException.class,
                        refused -> assertThat(refused.reason()).isEqualTo(Reason.KEY_NOT_CONFIGURED));
        // A key id reused for other material does not open the old row either.
        DisplayKeyRing reused = DisplayKeyRing.parse("k1:" + K2, "k1");
        assertThatThrownBy(() -> reused.open("k1", oldRow, aad(3))).isInstanceOf(DisplayPayloadException.class);
    }

    @Test
    void malformedConfigurationIsRefusedWithoutQuotingKeyMaterial() {
        String shortKey = Base64.getEncoder().encodeToString(new byte[16]);
        String[][] refused = {
                { "", "k1" },
                { "k1:" + K1, "" },
                { "k1:" + K1, "k9" },
                { "k1" + K1, "k1" },
                { "k1:" + shortKey, "k1" },
                { "k1:not*base64", "k1" },
                { "k1:" + K1 + ",k1:" + K2, "k1" },
                { "k 1:" + K1, "k 1" },
                { "k1:" + K1 + ",", "k1" },
        };
        for (String[] configuration : refused) {
            assertThatThrownBy(() -> DisplayKeyRing.parse(configuration[0], configuration[1]))
                    .isInstanceOf(InvalidDisplayKeysException.class)
                    .satisfies(failure -> assertThat(failure.getMessage()).doesNotContain(K1, K2, shortKey));
        }
        assertThat(DisplayKeyRing.parse(" k1:" + K1 + " , k2:" + K2 + " ", "k2").keyIds())
                .containsExactly("k1", "k2");
        assertThat(DisplayKeyRing.parse("k1:" + K1, "k1").toString()).doesNotContain(K1);
    }

    @Test
    void anEnabledFlowNeedsValidKeysAndProvidedKeysAreAlwaysChecked() {
        assertThatThrownBy(() -> new DisplayEncryption(true, "", ""))
                .isInstanceOf(InvalidDisplayKeysException.class);
        assertThatThrownBy(() -> new DisplayEncryption(false, "k1:short", "k1"))
                .isInstanceOf(InvalidDisplayKeysException.class);

        DisplayEncryption disabled = new DisplayEncryption(false, "", "");
        assertThat(disabled.enabled()).isFalse();
        assertThat(disabled.configuredKeys()).isEmpty();
        assertThatThrownBy(disabled::keyRing).isInstanceOf(IllegalStateException.class);

        assertThat(new DisplayEncryption(true, "k1:" + K1, "k1").keyRing().activeKeyId()).isEqualTo("k1");
    }
}
