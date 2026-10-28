package ca.aegis.control.shared.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.stream.Collectors;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import tools.jackson.databind.json.JsonMapper;

/** Document 09, sections 11.1, 22.3 and 23.2: the {@code q} search parameter. */
class SearchTextTests {

    /** Shared with the Web and iOS tests; Maven runs the tests from {@code services/api}. */
    private static final Path CORPUS = Path.of("../../docs/cahier-conception/09-corpus-recherche-q.json");

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Corpus(List<Case> cases) {
    }

    record Part(String text, Integer times) {
    }

    record Case(String id, List<Part> parts, List<Part> trimmed, int graphemes, String result) {

        @Override
        public String toString() {
            return id;
        }
    }

    static List<Case> sharedCases() throws IOException {
        return JsonMapper.builder().build().readValue(Files.readString(CORPUS), Corpus.class).cases();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("sharedCases")
    void followsTheCorpusSharedWithWebAndIos(Case expected) {
        String input = text(expected.parts());
        String trimmed = SearchText.strip(input);
        assertEquals(text(expected.trimmed() == null ? expected.parts() : expected.trimmed()), trimmed);
        assertEquals(expected.graphemes(), SearchText.graphemeCount(trimmed));
        if (expected.result().equals("VALID")) {
            assertEquals(Optional.of("%" + trimmed.toLowerCase(Locale.ROOT) + "%"), SearchText.containsPattern(input));
        } else {
            assertRefused(expected.result(), input);
        }
    }

    @Test
    void unpairedSurrogatesAreRefused() {
        String wrench = Character.toString(0x1F527);
        String high = wrench.substring(0, 1);
        String low = wrench.substring(1);
        for (String text : List.of("a" + high + "b", "a" + low + "b", low + high, high)) {
            assertRefused("INVALID_VALUE", text);
        }
    }

    @Test
    void likeWildcardsAndTheEscapeCharacterAreEscaped() {
        assertEquals(Optional.of("%50\\%\\_a\\\\b%"), SearchText.containsPattern(" 50%_A\\b "));
    }

    @Test
    void absentParameterMeansNoSearch() {
        assertEquals(Optional.empty(), SearchText.containsPattern(null));
    }

    private static String text(List<Part> parts) {
        return parts.stream()
                .map(part -> part.text().repeat(part.times() == null ? 1 : part.times()))
                .collect(Collectors.joining());
    }

    private static void assertRefused(String code, String raw) {
        InvalidRequestException refused =
                assertThrows(InvalidRequestException.class, () -> SearchText.containsPattern(raw));
        assertEquals(1, refused.violations().size());
        assertEquals("q", refused.violations().getFirst().field());
        assertEquals(code, refused.violations().getFirst().code());
    }
}
