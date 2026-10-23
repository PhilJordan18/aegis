package ca.aegis.control.locker;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import ca.aegis.control.audit.AuditEvent;
import ca.aegis.control.audit.AuditEventType;
import ca.aegis.control.audit.AuditResult;
import ca.aegis.control.audit.AuditSubjectType;
import ca.aegis.control.audit.AuditTrail;
import ca.aegis.control.shared.web.ResourceNotFoundException;

/**
 * Operating schedule of a locker (document 09, section 13). A change archives the active version and inserts a new
 * one with its seven windows, in one transaction under the locker row lock; the partial unique index of V004 remains
 * the final guard.
 */
@Service
class OperatingScheduleService {

    private final OperatingScheduleRepository schedules;
    private final AuditTrail audit;
    private final Clock clock;

    OperatingScheduleService(OperatingScheduleRepository schedules, AuditTrail audit, Clock clock) {
        this.schedules = schedules;
        this.audit = audit;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    OperatingScheduleView active(UUID lockerId) {
        if (!schedules.lockerExists(lockerId)) {
            throw new ResourceNotFoundException();
        }
        return schedules.activeOf(lockerId).map(this::view)
                .orElseThrow(OperatingScheduleNotConfiguredException::new);
    }

    /**
     * Replacing the schedule with the same zone and the same seven days changes nothing: no version, no event, and
     * the current version is returned (document 09, section 20.2).
     */
    @Transactional
    OperatingScheduleView replace(UUID lockerId, OperatingScheduleRequest request, UUID actor) {
        WeeklySchedule requested = OperatingScheduleRules.validate(request);
        if (!schedules.lockLocker(lockerId)) {
            throw new ResourceNotFoundException();
        }
        Optional<OperatingScheduleRepository.Version> previous = schedules.activeOf(lockerId);
        WeeklySchedule before = previous.map(schedules::weekOf).orElse(null);
        if (requested.equals(before)) {
            return view(previous.get(), before);
        }
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        previous.ifPresent(version -> schedules.archive(version.id(), now));
        UUID id = schedules.insert(lockerId, requested, actor, now);
        OperatingScheduleView created = view(schedules.find(id).orElseThrow(), requested);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("previousScheduleId", previous.map(version -> version.id().toString()).orElse(null));
        details.put("before", before == null ? null : snapshot(before));
        details.put("after", snapshot(requested));
        audit.record(new AuditEvent(AuditEventType.SCHEDULE_UPDATED, actor, AuditSubjectType.OPERATING_SCHEDULE, id,
                AuditResult.ACCEPTED, details, now));
        return created;
    }

    private OperatingScheduleView view(OperatingScheduleRepository.Version version) {
        return view(version, schedules.weekOf(version));
    }

    private static OperatingScheduleView view(OperatingScheduleRepository.Version version, WeeklySchedule week) {
        return new OperatingScheduleView(version.id(), version.lockerId(), version.timeZone(), version.createdAt(),
                version.createdByUserId(), week.windows().stream().map(OperatingWindowView::of).toList());
    }

    private static Map<String, Object> snapshot(WeeklySchedule schedule) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("timeZone", schedule.timeZone().getId());
        fields.put("windows", schedule.windows().stream().map(OperatingScheduleService::snapshot).toList());
        return fields;
    }

    private static Map<String, Object> snapshot(DailyWindow window) {
        OperatingWindowView view = OperatingWindowView.of(window);
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("dayOfWeek", view.dayOfWeek().name());
        fields.put("enabled", view.enabled());
        fields.put("opensAt", view.opensAt());
        fields.put("closesAt", view.closesAt());
        return fields;
    }
}
