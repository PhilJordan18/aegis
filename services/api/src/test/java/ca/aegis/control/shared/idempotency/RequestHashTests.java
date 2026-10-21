package ca.aegis.control.shared.idempotency;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.json.JsonMapper;

import ca.aegis.control.shared.idempotency.IdempotencyWebConfiguration.IdempotentRequestResolver;
import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.ApiException;
import ca.aegis.control.shared.web.InvalidRequestException;

class RequestHashTests {

    private static final UUID ACTOR = UUID.randomUUID();
    private static final String ARCHIVE = "/admin/assets/{assetId}/archive";

    @Test
    void canonicalJsonSortsEveryObjectAndKeepsArrayOrder() {
        JsonMapper mapper = JsonMapper.builder().build();
        String canonical = new String(RequestHash.canonicalJson(mapper.readTree("""
                { "b" : 1, "a" : { "d" : [ { "f" : 1, "e" : 2 }, 3 ], "c" : null } }
                """)), StandardCharsets.UTF_8);

        assertEquals("{\"a\":{\"c\":null,\"d\":[{\"e\":2,\"f\":1},3]},\"b\":1}", canonical);
    }

    @Test
    void theSameIntentHasTheSameHashWhateverTheKeyOrderOrTheKey() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "Multimètre");
        body.put("tags", List.of("b", "a"));
        Map<String, Object> reordered = new LinkedHashMap<>();
        reordered.put("tags", List.of("b", "a"));
        reordered.put("name", "Multimètre");

        byte[] hash = RequestHash.of(request("k1", "POST", "/admin/asset-models", Map.of()), body);
        assertEquals(32, hash.length);
        assertArrayEquals(hash, RequestHash.of(request("k2", "POST", "/admin/asset-models", Map.of()), reordered));
        assertArrayEquals(hash, RequestHash.of(new IdempotentRequest(UUID.randomUUID(), "k1", "POST",
                "/admin/asset-models", Map.of()), body));
    }

    @Test
    void methodRoutePathParametersAndBodyAreEachPartOfTheIntent() {
        String asset = UUID.randomUUID().toString();
        byte[] hash = RequestHash.of(request("k", "POST", ARCHIVE, Map.of("assetId", asset)), null);

        List<byte[]> others = List.of(
                RequestHash.of(request("k", "POST", ARCHIVE, Map.of("assetId", UUID.randomUUID().toString())), null),
                RequestHash.of(request("k", "PUT", ARCHIVE, Map.of("assetId", asset)), null),
                RequestHash.of(request("k", "POST", "/admin/asset-models/{assetId}/archive",
                        Map.of("assetId", asset)), null),
                RequestHash.of(request("k", "POST", ARCHIVE, Map.of("assetId", asset)), Map.of()),
                RequestHash.of(request("k", "POST", ARCHIVE, Map.of("assetId", asset)), Map.of("reason", "x")));
        for (byte[] other : others) {
            assertFalse(Arrays.equals(hash, other));
        }
    }

    @Test
    void theKeyIsRequiredAndLimitedTo128Characters() {
        for (String missing : new String[] {null, "", "   "}) {
            ApiException refused = assertThrows(ApiException.class, () -> IdempotentRequestResolver.requireKey(missing));
            assertEquals(ApiError.IDEMPOTENCY_KEY_REQUIRED, refused.error());
        }
        InvalidRequestException tooLong = assertThrows(InvalidRequestException.class,
                () -> IdempotentRequestResolver.requireKey("k".repeat(129)));
        assertEquals("Idempotency-Key", tooLong.violations().getFirst().field());
        assertEquals("SIZE", tooLong.violations().getFirst().code());
        assertEquals("k".repeat(128), IdempotentRequestResolver.requireKey("k".repeat(128)));
    }

    private static IdempotentRequest request(String key, String method, String route, Map<String, String> path) {
        return new IdempotentRequest(ACTOR, key, method, route, path);
    }
}
