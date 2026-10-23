package ca.aegis.control.shared.web;

import java.util.List;

/** Page envelope of the simple lists (document 09, sections 11.1 and 22.1). */
public record PageResponse<T>(List<T> items, int page, int size, long totalItems, long totalPages) {

    public static <T> PageResponse<T> of(List<T> items, PageQuery query, long totalItems) {
        long totalPages = totalItems == 0 ? 0 : (totalItems + query.size() - 1) / query.size();
        return new PageResponse<>(List.copyOf(items), query.page(), query.size(), totalItems, totalPages);
    }
}
