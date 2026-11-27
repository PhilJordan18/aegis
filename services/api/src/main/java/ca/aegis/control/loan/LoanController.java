package ca.aegis.control.loan;

import java.util.UUID;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import ca.aegis.control.identity.CurrentAccount;
import ca.aegis.control.shared.web.PageQuery;
import ca.aegis.control.shared.web.PageResponse;
import ca.aegis.control.shared.web.QueryFilters;

/** Technician loan reads of document 09, section 15.3, reserved to technicians by {@code ApiRoutes}. */
@RestController
class LoanController {

    private final LoanService loans;

    LoanController(LoanService loans) {
        this.loans = loans;
    }

    @GetMapping("/api/v1/me/loans")
    PageResponse<LoanView> history(@AuthenticationPrincipal CurrentAccount technician,
            @RequestParam(required = false) String status, @RequestParam(required = false) String page,
            @RequestParam(required = false) String size) {
        QueryFilters filters = new QueryFilters();
        LoanStatus selectedStatus = filters.enumeration("status", status, LoanStatus.class);
        filters.validate();
        return loans.historyOf(technician.id(), selectedStatus, PageQuery.parse(page, size));
    }

    @GetMapping("/api/v1/me/loan")
    LoanView mine(@AuthenticationPrincipal CurrentAccount technician) {
        return loans.currentOf(technician.id());
    }

    @GetMapping("/api/v1/loans/{loanId}")
    LoanView get(@AuthenticationPrincipal CurrentAccount technician, @PathVariable UUID loanId) {
        return loans.ownedBy(technician.id(), loanId);
    }
}
