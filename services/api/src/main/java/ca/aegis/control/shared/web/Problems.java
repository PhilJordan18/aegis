package ca.aegis.control.shared.web;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.List;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;

import tools.jackson.databind.json.JsonMapper;

/** Builds contract-compliant problem responses for MVC handlers and security filters alike. */
@Component
public class Problems {

    private final Clock clock;
    private final JsonMapper jsonMapper;

    public Problems(Clock clock, JsonMapper jsonMapper) {
        this.clock = clock;
        this.jsonMapper = jsonMapper;
    }

    public ProblemResponse body(ApiError error, int status, HttpServletRequest request,
            List<ProblemResponse.Violation> violations) {
        return new ProblemResponse(error.type(), error.title(), status, error.name(), error.detail(),
                request.getRequestURI(), RequestIdFilter.requestId(request),
                clock.instant().truncatedTo(ChronoUnit.SECONDS), null, violations);
    }

    public ResponseEntity<Object> entity(ApiError error, HttpServletRequest request) {
        return entity(error, error.status().value(), new HttpHeaders(), request, null);
    }

    public ResponseEntity<Object> entity(ApiError error, int status, HttpHeaders headers, HttpServletRequest request,
            List<ProblemResponse.Violation> violations) {
        HttpHeaders problemHeaders = new HttpHeaders();
        problemHeaders.addAll(headers);
        problemHeaders.setContentType(MediaType.APPLICATION_PROBLEM_JSON);
        return ResponseEntity.status(status).headers(problemHeaders).body(body(error, status, request, violations));
    }

    public void write(HttpServletRequest request, HttpServletResponse response, ApiError error) throws IOException {
        response.setStatus(error.status().value());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        jsonMapper.writeValue(response.getOutputStream(), body(error, error.status().value(), request, null));
    }
}
