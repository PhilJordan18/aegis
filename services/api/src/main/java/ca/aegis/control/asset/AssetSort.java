package ca.aegis.control.asset;

import java.util.Locale;

import ca.aegis.control.shared.web.InvalidRequestException;

/**
 * {@code sort} parameter of the asset lists (document 09, section 11.1): {@code assetCode} or {@code modelName},
 * optionally followed by {@code ,asc} or {@code ,desc}. The identifier is always the last, stable criterion
 * (section 22.1). Only these constant SQL fragments ever reach the query.
 */
enum AssetSort {
    ASSET_CODE_ASC("lower(a.asset_code) ASC, a.id ASC"),
    ASSET_CODE_DESC("lower(a.asset_code) DESC, a.id ASC"),
    MODEL_NAME_ASC("lower(m.name) ASC, lower(a.asset_code) ASC, a.id ASC"),
    MODEL_NAME_DESC("lower(m.name) DESC, lower(a.asset_code) ASC, a.id ASC");

    static final String DEFAULT = "assetCode,asc";

    private final String orderBy;

    AssetSort(String orderBy) {
        this.orderBy = orderBy;
    }

    String orderBy() {
        return orderBy;
    }

    static AssetSort parse(String raw) {
        String[] parts = raw.strip().split(",", -1);
        String direction = parts.length == 2 ? parts[1].strip().toLowerCase(Locale.ROOT) : "asc";
        if (parts.length <= 2 && (direction.equals("asc") || direction.equals("desc"))) {
            boolean ascending = direction.equals("asc");
            switch (parts[0].strip()) {
                case "assetCode" -> {
                    return ascending ? ASSET_CODE_ASC : ASSET_CODE_DESC;
                }
                case "modelName" -> {
                    return ascending ? MODEL_NAME_ASC : MODEL_NAME_DESC;
                }
                default -> { }
            }
        }
        throw InvalidRequestException.of("sort", "INVALID_VALUE",
                "Le tri doit être assetCode ou modelName, suivi de ,asc ou ,desc.");
    }
}
