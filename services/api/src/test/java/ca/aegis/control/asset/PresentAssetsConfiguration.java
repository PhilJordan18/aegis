package ca.aegis.control.asset;

import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/**
 * Test-only physical presence: every asset is {@code PRESENT}. A test class imports it explicitly to reach
 * {@code READY}; production keeps {@link NoPhysicalProofPresence} until PHY-02 (decision of 28 October 2026).
 */
@TestConfiguration(proxyBeanMethods = false)
public class PresentAssetsConfiguration {

    @Bean
    @Primary
    PhysicalPresence presentForTests() {
        return (assetIds, now) -> assetIds.stream().distinct()
                .collect(Collectors.toMap(Function.identity(), id -> Presence.PRESENT, (a, b) -> a));
    }
}
