package ca.aegis.control.loan;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import ca.aegis.control.asset.AssetSummary;
import ca.aegis.control.asset.ReservableAssets;
import ca.aegis.control.identity.UserSummaries;
import ca.aegis.control.identity.UserSummary;
import ca.aegis.control.loan.LoanRepository.AdminFilter;
import ca.aegis.control.loan.LoanRepository.LoanRow;
import ca.aegis.control.reservation.ReturnGuards;
import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;
import ca.aegis.control.shared.web.PageQuery;
import ca.aegis.control.shared.web.PageResponse;
import ca.aegis.control.shared.web.ResourceNotFoundException;

/**
 * Loan reads of document 09, section 15.3. Loans are created and closed by the checkout and return confirmations
 * (#47 and later); this service only reads them and changes no state.
 */
@Service
class LoanService {

    private static final Logger log = LoggerFactory.getLogger(LoanService.class);

    private final LoanRepository loans;
    private final ReservableAssets assets;
    private final UserSummaries users;
    private final ReturnGuards returns;
    private final Clock clock;

    LoanService(LoanRepository loans, ReservableAssets assets, UserSummaries users, ReturnGuards returns,
            Clock clock) {
        this.loans = loans;
        this.assets = assets;
        this.users = users;
        this.returns = returns;
        this.clock = clock;
    }

    /** The open loan of the technician, or {@code 404 ACTIVE_LOAN_NOT_FOUND} when there is none. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    LoanView currentOf(UUID technicianId) {
        List<LoanRow> open = loans.openOfHolder(technicianId);
        if (open.isEmpty()) {
            throw new LoanNotFoundException();
        }
        if (open.size() > 1) {
            // Section 15.3 keeps a singular view in P0; a second open loan is reported, never hidden silently.
            log.warn("Technician holds several open loans; the oldest is returned: holderUserId={}, loanIds={}",
                    technicianId, open.stream().map(LoanRow::id).toList());
        }
        return holderView(open.getFirst(), clock.instant());
    }

    /** Document 09, sections 15.3 and 26.2: another holder's loan is not visible, so it is not found. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    LoanView ownedBy(UUID technicianId, UUID loanId) {
        return loans.find(loanId).filter(row -> row.holderUserId().equals(technicianId))
                .map(row -> holderView(row, clock.instant()))
                .orElseThrow(ResourceNotFoundException::new);
    }

    /**
     * Document 09, section 17: every loan, read only; the count and the page see one snapshot. {@code overdue} is
     * derived as for the holder and never frees the asset (document 06, section 14.3).
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    PageResponse<AdminLoanView> adminList(AdminFilter filter, PageQuery page) {
        Instant now = clock.instant();
        long total = loans.count(filter);
        List<LoanRow> rows = total == 0 ? List.of() : loans.page(filter, page);
        Map<UUID, AssetSummary> summaries = assets.summaries(rows.stream().map(LoanRow::assetId).toList());
        Map<UUID, UserSummary> holders = users.of(rows.stream().map(LoanRow::holderUserId).toList());
        return PageResponse.of(rows.stream().map(row -> AdminLoanView.of(view(row, summaries.get(row.assetId()), now),
                holders.get(row.holderUserId()))).toList(), page, total);
    }

    /** Document 09, section 17: any loan, whoever holds it. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    AdminLoanView adminGet(UUID loanId) {
        return loans.find(loanId).map(row -> AdminLoanView.of(view(row, clock.instant()),
                users.of(List.of(row.holderUserId())).get(row.holderUserId())))
                .orElseThrow(ResourceNotFoundException::new);
    }

    private LoanView view(LoanRow row, Instant now) {
        return view(row, assets.summaries(List.of(row.assetId())).get(row.assetId()), now, List.of());
    }

    private LoanView view(LoanRow row, AssetSummary asset, Instant now) {
        return view(row, asset, now, List.of());
    }

    /**
     * Section 8.10: the holder sees {@code RETURN} only when the return preparation would accept the request now. It is
     * a hint read without locks; the preparation checks everything again. An administrator view never offers it.
     */
    private LoanView holderView(LoanRow row, Instant now) {
        List<String> actions = returns.returnAdmissible(row.holderUserId(), row.assetId(), row.status(), now)
                ? List.of("RETURN") : List.of();
        return view(row, assets.summaries(List.of(row.assetId())).get(row.assetId()), now, actions);
    }

    private LoanView view(LoanRow row, AssetSummary asset, Instant now, List<String> actions) {
        boolean open = row.status() != LoanStatus.COMPLETED;
        UUID currentOperation = open ? loans.latestReturnAttemptOf(row.id()).orElse(null) : null;
        return new LoanView(row.id(), asset, row.holderUserId(), row.status(), row.checkedOutAt(), row.dueAt(),
                open && now.isAfter(row.dueAt()), row.returnRequestedAt(), row.returnedAt(),
                row.checkoutOperationId(), row.returnOperationId(), currentOperation, actions);
    }

    static final class LoanNotFoundException extends ApiException {

        LoanNotFoundException() {
            super(ApiError.ACTIVE_LOAN_NOT_FOUND);
        }
    }
}
