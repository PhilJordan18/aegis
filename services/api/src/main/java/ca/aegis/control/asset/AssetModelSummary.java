package ca.aegis.control.asset;

import java.util.UUID;

/** Model summary embedded in asset views (document 09, section 8.2). */
public record AssetModelSummary(UUID id, String name, String manufacturer, String modelNumber) {
}
