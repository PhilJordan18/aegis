package ca.aegis.control.command;

import java.time.Clock;
import java.time.Duration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.support.TransactionTemplate;

import ca.aegis.control.audit.AuditTrail;
import ca.aegis.control.device.MqttProperties;

/**
 * The outbox worker of ADR-005, inside the monolith. It runs only when {@code aegis.commands.dispatcher.enabled} is
 * true, and then requires the MQTT connection of {@code aegis.mqtt}: a dispatcher without a broker fails at start
 * instead of leaving commands silently unpublished.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "aegis.commands.dispatcher.enabled", havingValue = "true")
class CommandDispatchConfiguration {

    @Bean
    MqttCommandPublisher mqttCommandPublisher(MqttProperties properties,
            @Value("${aegis.commands.dispatcher.publish-timeout:PT5S}") Duration publishTimeout) {
        if (!properties.enabled()) {
            throw new IllegalStateException("aegis.commands.dispatcher.enabled=true requires aegis.mqtt.enabled=true");
        }
        return new MqttCommandPublisher(properties, publishTimeout);
    }

    /** Section 9.2: the 15-second lease is an operating choice, distinct from the 120-second operation window. */
    @Bean
    CommandDispatcher commandDispatcher(JdbcClient jdbc, TransactionTemplate transactions, AuditTrail auditTrail,
            Clock clock, MqttCommandPublisher publisher,
            @Value("${aegis.commands.dispatcher.lease:PT15S}") Duration lease,
            @Value("${aegis.commands.dispatcher.publish-timeout:PT5S}") Duration publishTimeout) {
        // A publication that may outlast its lease would let a second claim publish while the first still waits.
        if (publishTimeout.compareTo(lease) >= 0) {
            throw new IllegalStateException("aegis.commands.dispatcher.publish-timeout must be shorter than its lease");
        }
        return new CommandDispatcher(jdbc, transactions, auditTrail, clock, publisher, lease);
    }

    @Bean
    CommandDispatchJob commandDispatchJob(CommandDispatcher dispatcher,
            @Value("${aegis.commands.dispatcher.batch-size:20}") int batchSize) {
        return new CommandDispatchJob(dispatcher, batchSize);
    }

    static final class CommandDispatchJob {

        private final CommandDispatcher dispatcher;
        private final int batchSize;

        CommandDispatchJob(CommandDispatcher dispatcher, int batchSize) {
            this.dispatcher = dispatcher;
            this.batchSize = batchSize;
        }

        /** A pass never overlaps another in this instance; other instances are kept apart by the claim. */
        @Scheduled(fixedDelayString = "${aegis.commands.dispatcher.interval:PT1S}")
        void run() {
            dispatcher.dispatchDue(batchSize);
        }
    }
}
