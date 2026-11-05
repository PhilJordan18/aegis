package ca.aegis.control.asset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

import com.jayway.jsonpath.JsonPath;

/**
 * The same refusals as {@link CatalogTextCharacterTests}, through the embedded Tomcat with the bytes written on the
 * socket: MockMvc never runs the connector's header parser nor the firewall's lazy header check, and these were the
 * paths that answered 500. Java's HTTP clients refuse to send such header bytes, hence the raw HTTP/1.1.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class CatalogTextCharacterHttpTests extends CatalogApiTest {

    @LocalServerPort
    int port;

    /** Bytes that Tomcat lets through to the application: tabulation and obs-text (RFC 9110, section 5.5). */
    @Test
    void anIdempotencyKeyWithAControlCharacterTheConnectorAcceptsIsAProblemNotAServerError() throws Exception {
        for (byte[] character : List.of(bytes(0x85), bytes(0xC2, 0x85), bytes(0x9F), bytes(0x09))) {
            String marker = marker();
            Response response = postModel(key(marker, character), modelJson("Clé " + marker));

            assertInvalidValueProblem(response, "Idempotency-Key", marker, Arrays.toString(character));
            assertEquals(0, modelsContaining(marker));
            assertEquals(0, keysStartingWith("key-" + marker));
        }
    }

    /**
     * Tomcat's header parser refuses these bytes with its own minimal 400 page before the application runs, so the
     * answer is not a problem document. The test pins what matters: a client error, and nothing stored.
     */
    @Test
    void anIdempotencyKeyWithAControlCharacterTheConnectorRefusesStoresNothing() throws Exception {
        for (byte[] character : List.of(bytes(0x00), bytes(0x01), bytes(0x7F))) {
            String marker = marker();
            Response response = postModel(key(marker, character), modelJson("Clé " + marker));

            assertEquals(400, response.status(), Arrays.toString(character));
            assertEquals(0, modelsContaining(marker));
            assertEquals(0, keysStartingWith("key-" + marker));
        }
    }

    @Test
    void aNulInTheJsonBodyIsAProblemNotAServerError() throws Exception {
        String marker = marker();
        String json = modelJson("Corps " + marker).replace("\"name\":\"Corps ", "\"name\":\"A\\u0000Corps ");

        Response response = postModel(UUID.randomUUID().toString().getBytes(StandardCharsets.US_ASCII), json);

        assertInvalidValueProblem(response, "name", marker, "NUL in name");
        assertEquals(0, modelsContaining(marker));
    }

    @Test
    void aNulInTheSearchParameterIsAProblemNotAServerError() throws Exception {
        String marker = marker();

        Response response = exchange(("GET " + ASSETS + "?q=" + marker + "%00 HTTP/1.1\r\nHost: localhost\r\n"
                + "Connection: close\r\nAuthorization: Bearer " + adminToken + "\r\n\r\n")
                .getBytes(StandardCharsets.US_ASCII));

        assertInvalidValueProblem(response, "q", marker, "q with %00");
    }

    private static void assertInvalidValueProblem(Response response, String field, String echoed, String label) {
        assertEquals(400, response.status(), label);
        assertTrue(response.header("content-type").startsWith("application/problem+json"), label);
        assertEquals("VALIDATION_ERROR", JsonPath.read(response.body(), "$.code"), label);
        assertEquals(List.of(field), JsonPath.read(response.body(), "$.violations[*].field"), label);
        assertEquals(List.of("INVALID_VALUE"), JsonPath.read(response.body(), "$.violations[*].code"), label);
        assertFalse(response.body().contains(echoed), "the problem must not echo the refused value: " + label);
    }

    private Response postModel(byte[] idempotencyKey, String json) throws IOException {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        ByteArrayOutputStream request = new ByteArrayOutputStream();
        request.writeBytes(("POST " + MODELS + " HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n"
                + "Authorization: Bearer " + adminToken + "\r\nContent-Type: application/json\r\n"
                + "Content-Length: " + body.length + "\r\n" + IDEMPOTENCY_KEY + ": ")
                .getBytes(StandardCharsets.US_ASCII));
        request.writeBytes(idempotencyKey);
        request.writeBytes("\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
        request.writeBytes(body);
        return exchange(request.toByteArray());
    }

    private Response exchange(byte[] request) throws IOException {
        try (Socket socket = new Socket("127.0.0.1", port)) {
            socket.setSoTimeout(10_000);
            OutputStream out = socket.getOutputStream();
            out.write(request);
            out.flush();
            InputStream in = socket.getInputStream();
            return Response.parse(in.readAllBytes());
        }
    }

    private String modelJson(String name) {
        return jsonMapper.writeValueAsString(modelBody(name));
    }

    private static byte[] key(String marker, byte[] character) {
        ByteArrayOutputStream key = new ByteArrayOutputStream();
        key.writeBytes(("key-" + marker).getBytes(StandardCharsets.US_ASCII));
        key.writeBytes(character);
        key.writeBytes("end".getBytes(StandardCharsets.US_ASCII));
        return key.toByteArray();
    }

    private static byte[] bytes(int... values) {
        byte[] bytes = new byte[values.length];
        for (int i = 0; i < values.length; i++) {
            bytes[i] = (byte) values[i];
        }
        return bytes;
    }

    private static String marker() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    /** By marker only: PostgreSQL refuses a NUL even as a query parameter. */
    private long modelsContaining(String marker) {
        return jdbc.sql("SELECT count(*) FROM aegis.asset_models WHERE strpos(name, :marker) > 0")
                .param("marker", marker)
                .query(Long.class)
                .single();
    }

    private long keysStartingWith(String prefix) {
        return jdbc.sql("SELECT count(*) FROM aegis.rest_idempotency_keys WHERE idempotency_key LIKE :prefix")
                .param("prefix", prefix + "%")
                .query(Long.class)
                .single();
    }

    /** An HTTP/1.1 response read until the server closes the connection, with a chunked body decoded. */
    private record Response(int status, String headers, String body) {

        static Response parse(byte[] raw) {
            int end = indexOf(raw, "\r\n\r\n".getBytes(StandardCharsets.US_ASCII), 0);
            if (end < 0) {
                throw new IllegalStateException("incomplete HTTP response: " + raw.length + " bytes");
            }
            String head = new String(raw, 0, end, StandardCharsets.ISO_8859_1);
            byte[] content = Arrays.copyOfRange(raw, end + 4, raw.length);
            int status = Integer.parseInt(head.substring(9, 12));
            boolean chunked = head.toLowerCase(Locale.ROOT).contains("\r\ntransfer-encoding: chunked");
            return new Response(status, head, new String(chunked ? dechunk(content) : content, StandardCharsets.UTF_8));
        }

        String header(String name) {
            return headers.lines()
                    .filter(line -> line.toLowerCase(Locale.ROOT).startsWith(name + ":"))
                    .map(line -> line.substring(name.length() + 1).trim())
                    .findFirst()
                    .orElse("");
        }

        private static byte[] dechunk(byte[] content) {
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            int position = 0;
            while (true) {
                int lineEnd = indexOf(content, "\r\n".getBytes(StandardCharsets.US_ASCII), position);
                int size = Integer.parseInt(new String(content, position, lineEnd - position,
                        StandardCharsets.US_ASCII).split(";")[0].trim(), 16);
                if (size == 0) {
                    return body.toByteArray();
                }
                body.write(content, lineEnd + 2, size);
                position = lineEnd + 2 + size + 2;
            }
        }

        private static int indexOf(byte[] data, byte[] pattern, int from) {
            for (int i = from; i <= data.length - pattern.length; i++) {
                if (Arrays.equals(data, i, i + pattern.length, pattern, 0, pattern.length)) {
                    return i;
                }
            }
            return -1;
        }
    }
}
