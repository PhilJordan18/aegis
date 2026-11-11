package ca.aegis.control.display;

import java.time.Clock;
import java.time.Duration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.support.TransactionTemplate;

import ca.aegis.control.command.MqttCommandPublisher;
import ca.aegis.control.device.MqttProperties;

/**
 * The display outbox worker. It runs only when {@code aegis.display.dispatcher.enabled} is true, and then requires
 * both the MQTT connection and the hub challenge flow with its keys: a worker that could not publish, or could not
 * open what it must publish, fails at start.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "aegis.display.dispatcher.enabled", havingValue = "true")
class DisplayDispatchConfiguration {

    static final String CLIENT_ID_SUFFIX = "-display";

    @Bean
    MqttCommandPublisher mqttDisplayPublisher(MqttProperties properties, DisplayEncryption encryption,
            @Value("${aegis.display.dispatcher.publish-timeout:PT5S}") Duration publishTimeout) {
        if (!properties.enabled()) {
            throw new IllegalStateException("aegis.display.dispatcher.enabled=true requires aegis.mqtt.enabled=true");
        }
        if (!encryption.enabled()) {
            throw new IllegalStateException("aegis.display.dispatcher.enabled=true requires aegis.display.enabled=true");
        }
        return new MqttCommandPublisher(properties, publishTimeout, CLIENT_ID_SUFFIX);
    }

    @Bean
    DisplayDispatcher displayDispatcher(JdbcClient jdbc, TransactionTemplate transactions, Clock clock,
            MqttCommandPublisher mqttDisplayPublisher, DisplayEncryption encryption,
            @Value("${aegis.display.dispatcher.lease:PT15S}") Duration lease,
            @Value("${aegis.display.dispatcher.publish-timeout:PT5S}") Duration publishTimeout) {
        if (publishTimeout.compareTo(lease) >= 0) {
            throw new IllegalStateException("aegis.display.dispatcher.publish-timeout must be shorter than its lease");
        }
        return new DisplayDispatcher(jdbc, transactions, clock, mqttDisplayPublisher, encryption, lease);
    }

    @Bean
    DisplayDispatchJob displayDispatchJob(DisplayDispatcher dispatcher,
            @Value("${aegis.display.dispatcher.batch-size:20}") int batchSize) {
        return new DisplayDispatchJob(dispatcher, batchSize);
    }

    static final class DisplayDispatchJob {

        private final DisplayDispatcher dispatcher;
        private final int batchSize;

        DisplayDispatchJob(DisplayDispatcher dispatcher, int batchSize) {
            this.dispatcher = dispatcher;
            this.batchSize = batchSize;
        }

        @Scheduled(fixedDelayString = "${aegis.display.dispatcher.interval:PT1S}")
        void run() {
            dispatcher.dispatchDue(batchSize);
        }
    }
}
