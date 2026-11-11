package ca.aegis.control.loan;

import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import ca.aegis.control.loan.LoanRepository.AdminFilter;
import ca.aegis.control.shared.web.PageQuery;
import ca.aegis.control.shared.web.PageResponse;
import ca.aegis.control.shared.web.QueryFilters;

/**
 * Read-only routes of document 09, section 17, reserved to administrators by {@code ApiRoutes}. There is no
 * complete-loan or force-return route: a loan only closes through a confirmed physical return.
 */
@RestController
@RequestMapping("/api/v1/admin/loans")
class AdminLoanController {

    private final LoanService loans;

    AdminLoanController(LoanService loans) {
        this.loans = loans;
    }

    @GetMapping
    PageResponse<LoanView> list(@RequestParam(required = false) String status,
            @RequestParam(required = false) String assetId, @RequestParam(required = false) String userId,
            @RequestParam(required = false) String from, @RequestParam(required = false) String to,
            @RequestParam(required = false) String page, @RequestParam(required = false) String size) {
        QueryFilters filters = new QueryFilters();
        AdminFilter filter = new AdminFilter(filters.enumeration("status", status, LoanStatus.class),
                filters.uuid("assetId", assetId), filters.uuid("userId", userId), filters.instant("from", from),
                filters.instant("to", to));
        filters.requireOrdered(filter.from(), filter.to());
        filters.validate();
        return loans.adminList(filter, PageQuery.parse(page, size));
    }

    @GetMapping("/{loanId}")
    LoanView get(@PathVariable UUID loanId) {
        return loans.adminGet(loanId);
    }
}
