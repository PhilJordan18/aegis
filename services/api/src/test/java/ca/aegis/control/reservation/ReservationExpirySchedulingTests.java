package ca.aegis.control.reservation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.scheduling.config.FixedDelayTask;
import org.springframework.scheduling.config.ScheduledTaskHolder;

/** The production wiring of the expiry job, which the integration tests turn off to control time themselves. */
class ReservationExpirySchedulingTests {

    private final ApplicationContextRunner context = new ApplicationContextRunner()
            .withBean(ReservationExpiry.class, () -> mock(ReservationExpiry.class))
            .withUserConfiguration(ReservationExpiryJob.class);

    @Test
    void theJobIsScheduledByDefaultWithAFixedDelay() {
        context.withPropertyValues("aegis.reservations.expiry.interval=PT15S").run(started -> {
            assertThat(started).hasSingleBean(ReservationExpiryJob.class);
            assertThat(started.getBeansOfType(ScheduledTaskHolder.class).values().stream()
                    .flatMap(holder -> holder.getScheduledTasks().stream())
                    .map(scheduled -> scheduled.getTask())
                    .filter(FixedDelayTask.class::isInstance).map(FixedDelayTask.class::cast)
                    .map(FixedDelayTask::getIntervalDuration))
                    .containsExactly(Duration.ofSeconds(15));
        });
    }

    @Test
    void theJobCanBeTurnedOff() {
        context.withPropertyValues("aegis.reservations.expiry.scheduled=false")
                .run(started -> assertThat(started).doesNotHaveBean(ReservationExpiryJob.class));
    }

    @Test
    void aPassContinuesWhileABatchIsFullAndStopsAfterAPartialOne() {
        ReservationExpiry expiry = mock(ReservationExpiry.class);
        when(expiry.expireDue(2)).thenReturn(2, 2, 1);

        new ReservationExpiryJob(expiry, 2).run();

        verify(expiry, times(3)).expireDue(2);
    }
}
