package ca.aegis.control.display;

import java.nio.ByteBuffer;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * The application encryption of {@code hub_display_outbox.encrypted_payload} (document 08, sections 4.6 and 9;
 * decision of 11 November 2026, #43 and #67): AES-256-GCM with keys held outside PostgreSQL, in
 * {@code AEGIS_DISPLAY_KEYS}, and the key of new rows named by {@code AEGIS_DISPLAY_ACTIVE_KEY_ID}.
 *
 * <p>The stored envelope is {@code nonce (12 bytes) || ciphertext || tag (16 bytes)}; the key id is stored apart, in
 * {@code encryption_key_id}. Each seal draws a fresh random nonce, which keeps the GCM nonce bound well within its
 * safe use for one key at the volume of a locker display. The associated data binds the envelope to its row
 * ({@link DisplayAad}), so a ciphertext copied to another row, locker, operation or revision fails to open.
 *
 * <p>Key material never leaves this class: {@link #toString()} and every message name key ids only.
 */
public final class DisplayKeyRing {

    static final int KEY_BYTES = 32;
    static final int NONCE_BYTES = 12;
    static final int TAG_BITS = 128;
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    /** Stored in a text column and in logs; restricted so it never needs escaping. */
    private static final Pattern KEY_ID = Pattern.compile("[A-Za-z0-9._-]{1,64}");

    private final Map<String, SecretKey> keys;
    private final String activeKeyId;
    private final SecureRandom random;

    private DisplayKeyRing(Map<String, SecretKey> keys, String activeKeyId, SecureRandom random) {
        this.keys = keys;
        this.activeKeyId = activeKeyId;
        this.random = random;
    }

    /**
     * Parses {@code AEGIS_DISPLAY_KEYS} ({@code keyId:base64,keyId:base64}, standard Base64 of exactly 32 bytes) and
     * {@code AEGIS_DISPLAY_ACTIVE_KEY_ID}. Every malformed entry is refused: a key ring is never partially loaded.
     *
     * @throws InvalidDisplayKeysException naming the faulty key id or position, never a key value
     */
    public static DisplayKeyRing parse(String encodedKeys, String activeKeyId) {
        if (encodedKeys == null || encodedKeys.isBlank()) {
            throw new InvalidDisplayKeysException("AEGIS_DISPLAY_KEYS is empty");
        }
        Map<String, SecretKey> keys = new LinkedHashMap<>();
        String[] entries = encodedKeys.split(",", -1);
        for (int position = 0; position < entries.length; position++) {
            String entry = entries[position].strip();
            int separator = entry.indexOf(':');
            if (separator < 0) {
                throw new InvalidDisplayKeysException("AEGIS_DISPLAY_KEYS entry " + (position + 1)
                        + " is not keyId:base64");
            }
            String keyId = entry.substring(0, separator);
            if (!KEY_ID.matcher(keyId).matches()) {
                throw new InvalidDisplayKeysException("AEGIS_DISPLAY_KEYS entry " + (position + 1)
                        + " has a key id outside [A-Za-z0-9._-]{1,64}");
            }
            byte[] material;
            try {
                material = Base64.getDecoder().decode(entry.substring(separator + 1));
            } catch (IllegalArgumentException notBase64) {
                throw new InvalidDisplayKeysException("Display key " + keyId + " is not standard Base64");
            }
            try {
                if (material.length != KEY_BYTES) {
                    throw new InvalidDisplayKeysException("Display key " + keyId + " is " + material.length
                            + " bytes; AES-256-GCM needs " + KEY_BYTES);
                }
                if (keys.putIfAbsent(keyId, new SecretKeySpec(material, "AES")) != null) {
                    throw new InvalidDisplayKeysException("Display key " + keyId + " is listed twice");
                }
            } finally {
                Arrays.fill(material, (byte) 0);
            }
        }
        if (activeKeyId == null || activeKeyId.isBlank()) {
            throw new InvalidDisplayKeysException("AEGIS_DISPLAY_ACTIVE_KEY_ID is empty");
        }
        if (!keys.containsKey(activeKeyId)) {
            throw new InvalidDisplayKeysException("AEGIS_DISPLAY_ACTIVE_KEY_ID names no key of AEGIS_DISPLAY_KEYS");
        }
        return new DisplayKeyRing(Collections.unmodifiableMap(keys), activeKeyId, new SecureRandom());
    }

    public String activeKeyId() {
        return activeKeyId;
    }

    public Set<String> keyIds() {
        return keys.keySet();
    }

    /** Encrypts with the active key and a fresh nonce. */
    public Sealed seal(byte[] plaintext, byte[] associatedData) {
        byte[] nonce = new byte[NONCE_BYTES];
        random.nextBytes(nonce);
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, keys.get(activeKeyId), new GCMParameterSpec(TAG_BITS, nonce));
            cipher.updateAAD(associatedData);
            byte[] sealed = cipher.doFinal(plaintext);
            return new Sealed(activeKeyId, ByteBuffer.allocate(NONCE_BYTES + sealed.length).put(nonce).put(sealed)
                    .array());
        } catch (GeneralSecurityException unavailable) {
            // The JDK always provides AES/GCM: this is a broken runtime, not bad input.
            throw new IllegalStateException("AES-256-GCM unavailable", unavailable);
        }
    }

    /**
     * Decrypts an envelope sealed by {@link #seal}. A key that is no longer configured, a truncated envelope, a
     * modified byte or other associated data all give the same refusal, without detail an attacker could use.
     */
    public byte[] open(String keyId, byte[] envelope, byte[] associatedData) {
        SecretKey key = keys.get(keyId);
        if (key == null) {
            throw new DisplayPayloadException(DisplayPayloadException.Reason.KEY_NOT_CONFIGURED);
        }
        if (envelope == null || envelope.length < NONCE_BYTES + TAG_BITS / 8) {
            throw new DisplayPayloadException(DisplayPayloadException.Reason.AUTHENTICATION_FAILED);
        }
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, envelope, 0, NONCE_BYTES));
            cipher.updateAAD(associatedData);
            return cipher.doFinal(envelope, NONCE_BYTES, envelope.length - NONCE_BYTES);
        } catch (AEADBadTagException tampered) {
            throw new DisplayPayloadException(DisplayPayloadException.Reason.AUTHENTICATION_FAILED);
        } catch (GeneralSecurityException unavailable) {
            throw new IllegalStateException("AES-256-GCM unavailable", unavailable);
        }
    }

    @Override
    public String toString() {
        return "DisplayKeyRing[activeKeyId=" + activeKeyId + ", keyIds=" + keys.keySet() + "]";
    }

    /** An envelope and the id of the key that sealed it. */
    public record Sealed(String keyId, byte[] envelope) {
    }

    /** A configuration that must stop the application from starting. */
    public static final class InvalidDisplayKeysException extends IllegalStateException {

        InvalidDisplayKeysException(String message) {
            super(message);
        }
    }
}
