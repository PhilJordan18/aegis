package ca.aegis.control.shared.scheduling;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Enables {@code @Scheduled} methods for the whole application, independently of any one job: turning a job off with
 * its own property never disables the others.
 */
@Configuration(proxyBeanMethods = false)
@EnableScheduling
public class SchedulingConfiguration {
}
