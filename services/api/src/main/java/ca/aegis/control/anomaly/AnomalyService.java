package ca.aegis.control.anomaly;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import ca.aegis.control.anomaly.AnomalyRepository.AdminFilter;
import ca.aegis.control.audit.AuditEvent;
import ca.aegis.control.audit.AuditEventType;
import ca.aegis.control.audit.AuditSubjectType;
import ca.aegis.control.audit.AuditTrail;
import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;
import ca.aegis.control.shared.web.PageQuery;
import ca.aegis.control.shared.web.PageResponse;
import ca.aegis.control.shared.web.ResourceNotFoundException;

/**
 * Anomaly administration of document 09, section 18. Reads write nothing. The acknowledgement records that an
 * administrator is informed: it never resolves the anomaly, and changes no operation, reservation, loan or custody
 * (document 05; only a coherent physical observation resolves an anomaly).
 */
@Service
class AnomalyService {

    private final AnomalyRepository anomalies;
    private final AuditTrail audit;
    private final Clock clock;

    AnomalyService(AnomalyRepository anomalies, AuditTrail audit, Clock clock) {
        this.anomalies = anomalies;
        this.audit = audit;
        this.clock = clock;
    }

    /** The count and the page see one snapshot. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    PageResponse<AnomalyView> list(AdminFilter filter, PageQuery page) {
        long total = anomalies.count(filter);
        return PageResponse.of(total == 0 ? List.of() : anomalies.page(filter, page), page, total);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    AnomalyDetailView detail(UUID anomalyId) {
        AnomalyView view = anomalies.find(anomalyId).orElseThrow(ResourceNotFoundException::new);
        return AnomalyDetailView.of(view,
                anomalies.evidence(view.lockerOperationId(), view.resolutionEvidenceObservationId()));
    }

    /**
     * {@code OPEN} to {@code ACKNOWLEDGED}, under the row lock, in the transaction of the idempotency key. Rule D6
     * approved on 11 November 2026 (#67): an anomaly already acknowledged keeps its first note and refuses
     * a new acknowledgement; a replay of the same key and body is answered by the idempotency service.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    AnomalyView acknowledge(UUID anomalyId, UUID actorUserId, String note) {
        AnomalyStatus status = anomalies.lockStatus(anomalyId).orElseThrow(ResourceNotFoundException::new);
        switch (status) {
            case RESOLVED -> throw new AnomalyRefusedException(ApiError.ANOMALY_ALREADY_RESOLVED);
            case ACKNOWLEDGED -> throw new AnomalyRefusedException(ApiError.ANOMALY_NOT_ACKNOWLEDGEABLE);
            case OPEN -> {
                // Acknowledged below.
            }
        }
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        anomalies.acknowledge(anomalyId, actorUserId, note, now);
        AnomalyView acknowledged = anomalies.find(anomalyId).orElseThrow();
        // The note is free text: it stays on the anomaly and never enters the audit details.
        audit.record(AuditEvent.transition(AuditEventType.ANOMALY_ACKNOWLEDGED, actorUserId,
                AuditSubjectType.ANOMALY, anomalyId, acknowledged.lockerOperationId(), AnomalyStatus.OPEN,
                AnomalyStatus.ACKNOWLEDGED, null,
                Map.of("type", acknowledged.type().name(), "severity", acknowledged.severity().name()), now));
        return acknowledged;
    }

    static final class AnomalyRefusedException extends ApiException {

        AnomalyRefusedException(ApiError error) {
            super(error);
        }
    }
}
