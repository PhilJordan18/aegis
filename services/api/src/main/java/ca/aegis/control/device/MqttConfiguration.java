package ca.aegis.control.device;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(MqttProperties.class)
class MqttConfiguration {

    @Bean
    @ConditionalOnProperty(prefix = "aegis.mqtt", name = "enabled", havingValue = "true")
    MqttIngestionClient mqttIngestionClient(MqttProperties properties, DeviceMessageIngestion ingestion) {
        return new MqttIngestionClient(properties, ingestion);
    }
}
