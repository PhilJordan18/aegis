package ca.aegis.control.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.Arrays;
import java.util.List;

import org.junit.jupiter.api.Test;

import ca.aegis.control.identity.DemoAccountProperties.DemoAccount;

class DemoAccountSettingsTests {

    @Test
    void validSettingsAreNormalizedAndDefaultToTheStandardLevel() {
        DemoAccountProvisioner.DemoAccount demo = DemoAccountProvisioner.validate(
                new DemoAccount("  Admin@Aegis.Demo ", " Administrateur ", "twelve-bytes", null),
                Role.ADMIN, "AEGIS_DEMO_ADMIN");

        assertEquals("admin@aegis.demo", demo.email());
        assertEquals("Administrateur", demo.displayName());
        assertEquals(Role.ADMIN, demo.role());
        assertEquals(AccessLevel.STANDARD, demo.maximumAccessLevel());
        assertThat(demo.toString()).doesNotContain("twelve-bytes");
        assertThat(new DemoAccount("a@aegis.demo", "A", "twelve-bytes", null).toString())
                .doesNotContain("twelve-bytes");
    }

    @Test
    void unsafeSettingsStopStartupWithoutRevealingThePassword() {
        String password = "a-valid-demo-password";
        List<DemoAccount> invalid = Arrays.asList(
                null,
                new DemoAccount(null, "Administrateur", password, null),
                new DemoAccount("not-an-email", "Administrateur", password, null),
                new DemoAccount("admin@", "Administrateur", password, null),
                new DemoAccount("admin@aegis.demo", "   ", password, null),
                new DemoAccount("admin@aegis.demo", "A".repeat(121), password, null),
                new DemoAccount("admin@aegis.demo", "Administrateur", null, null),
                new DemoAccount("admin@aegis.demo", "Administrateur", "eleven-byte", null),
                new DemoAccount("admin@aegis.demo", "Administrateur", "é".repeat(37), null));

        for (DemoAccount settings : invalid) {
            IllegalStateException failure = assertThrows(IllegalStateException.class,
                    () -> DemoAccountProvisioner.validate(settings, Role.ADMIN, "AEGIS_DEMO_ADMIN"));
            assertThat(failure.getMessage()).startsWith("AEGIS_DEMO_ADMIN").doesNotContain(password, "eleven-byte",
                    "é".repeat(37));
        }
    }
}
