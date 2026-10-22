package ca.aegis.control.shared.idempotency;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * SHA-256 of the canonical intent of a request (document 09, section 20.2): method, logical route, path parameters
 * and the request body, as one JSON document whose object keys are sorted and written without insignificant
 * whitespace. The key, the actor and {@code X-Request-Id} are not part of it.
 * <p>
 * The body is the deserialized request DTO, so two JSON texts that differ only by key order or whitespace express
 * the same intent. A private mapper is used: a change to the application's JSON settings must not change the hash
 * of a request already recorded.
 */
final class RequestHash {

    private static final JsonMapper CANONICAL = JsonMapper.builder().build();

    private RequestHash() {
    }

    static byte[] of(IdempotentRequest request, Object body) {
        ObjectNode intent = CANONICAL.createObjectNode();
        intent.put("method", request.method());
        intent.put("route", request.route());
        ObjectNode pathParameters = intent.putObject("pathParameters");
        request.pathParameters().forEach(pathParameters::put);
        if (body == null) {
            intent.putNull("body");
        } else {
            intent.set("body", CANONICAL.valueToTree(body));
        }
        return sha256(canonicalJson(intent));
    }

    static byte[] canonicalJson(JsonNode node) {
        return CANONICAL.writeValueAsBytes(sorted(node));
    }

    private static JsonNode sorted(JsonNode node) {
        if (node instanceof ObjectNode object) {
            List<Map.Entry<String, JsonNode>> properties = new ArrayList<>(object.properties());
            properties.sort(Map.Entry.comparingByKey());
            ObjectNode copy = CANONICAL.createObjectNode();
            properties.forEach(property -> copy.set(property.getKey(), sorted(property.getValue())));
            return copy;
        }
        if (node instanceof ArrayNode array) {
            ArrayNode copy = CANONICAL.createArrayNode();
            array.forEach(element -> copy.add(sorted(element)));
            return copy;
        }
        return node;
    }

    private static byte[] sha256(byte[] input) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(input);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("Every Java platform provides SHA-256", impossible);
        }
    }
}
