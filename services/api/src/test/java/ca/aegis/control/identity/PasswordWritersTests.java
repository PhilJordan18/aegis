package ca.aegis.control.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;

/**
 * ADR-017: {@link PasswordChanges} is the only code that rewrites a password hash, so no path can change a password
 * without revoking the account's browser sessions. Creating an account ({@code INSERT}) is not a change.
 */
class PasswordWritersTests {

    private static final Pattern REWRITE = Pattern.compile("(?is)UPDATE\\s+aegis\\.users\\b[^;\"]*?password_hash");

    @Test
    void onlyPasswordChangesRewritesAPasswordHash() throws IOException {
        List<String> writers;
        try (Stream<Path> sources = Files.walk(Path.of("src/main/java"))) {
            writers = sources.filter(path -> path.toString().endsWith(".java"))
                    .filter(PasswordWritersTests::rewritesAPasswordHash)
                    .map(path -> path.getFileName().toString())
                    .toList();
        }
        assertEquals(List.of("PasswordChanges.java"), writers);
    }

    private static boolean rewritesAPasswordHash(Path source) {
        try {
            return REWRITE.matcher(Files.readString(source)).find();
        } catch (IOException unreadable) {
            throw new IllegalStateException(unreadable);
        }
    }
}
