package ca.aegis.control.locker;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;

import ca.aegis.control.support.ApiIntegrationTest;

class DemoLockerDefaultsTests extends ApiIntegrationTest {

    @Autowired
    ApplicationContext context;

    @Test
    void noDemoLockerIsProvisionedUnlessEnabled() {
        assertEquals(0, context.getBeanNamesForType(DemoLockerProvisioner.class).length);
    }
}
