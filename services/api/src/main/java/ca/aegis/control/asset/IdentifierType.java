package ca.aegis.control.asset;

import java.util.Arrays;
import java.util.Optional;

/** Physical identifier technologies of document 03, section 4.5, as {@code ck_asset_identifiers_type} allows them. */
public enum IdentifierType {
    RFID_UHF,
    NFC,
    QR;

    static Optional<IdentifierType> parse(String value) {
        return Arrays.stream(values()).filter(type -> type.name().equals(value)).findFirst();
    }
}
