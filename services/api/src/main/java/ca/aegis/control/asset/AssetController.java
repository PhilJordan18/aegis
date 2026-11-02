package ca.aegis.control.asset;

import java.util.Optional;
import java.util.UUID;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import ca.aegis.control.identity.CurrentAccount;
import ca.aegis.control.shared.web.InvalidRequestException;
import ca.aegis.control.shared.web.PageQuery;
import ca.aegis.control.shared.web.PageResponse;
import ca.aegis.control.shared.web.SearchText;

/**
 * Technician catalog routes of document 09, section 11, reserved to technicians by {@code ApiRoutes}: an
 * administrator is not implicitly a technician (section 5). Readiness is always evaluated for the authenticated
 * account, never for a user named by the request.
 */
@RestController
@RequestMapping("/api/v1/assets")
class AssetController {

    private final TechnicianCatalogService catalog;

    AssetController(TechnicianCatalogService catalog) {
        this.catalog = catalog;
    }

    @GetMapping
    PageResponse<AssetView> list(@AuthenticationPrincipal CurrentAccount account,
            @RequestParam(required = false) String q, @RequestParam(required = false) String readiness,
            @RequestParam(required = false) String availability, @RequestParam(required = false) String page,
            @RequestParam(required = false) String size,
            @RequestParam(defaultValue = AssetSort.DEFAULT) String sort) {
        return catalog.list(account, PageQuery.parse(page, size), SearchText.containsPattern(q), AssetSort.parse(sort),
                filter(ReadinessResult.class, "readiness", readiness,
                        "Le filtre readiness doit valoir READY, BLOCKED ou UNKNOWN."),
                filter(Availability.class, "availability", availability,
                        "Le filtre availability doit valoir AVAILABLE, RESERVED, BORROWED ou UNAVAILABLE."));
    }

    @GetMapping("/{assetId}")
    AssetView get(@AuthenticationPrincipal CurrentAccount account, @PathVariable UUID assetId) {
        return catalog.get(account, assetId);
    }

    private static <E extends Enum<E>> Optional<E> filter(Class<E> type, String field, String raw, String message) {
        if (raw == null) {
            return Optional.empty();
        }
        for (E value : type.getEnumConstants()) {
            if (value.name().equals(raw.strip())) {
                return Optional.of(value);
            }
        }
        throw InvalidRequestException.of(field, "INVALID_VALUE", message);
    }
}
