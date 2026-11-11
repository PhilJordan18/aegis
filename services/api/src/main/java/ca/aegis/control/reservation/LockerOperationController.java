package ca.aegis.control.reservation;

import java.util.Iterator;
import java.util.UUID;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import ca.aegis.control.identity.CurrentAccount;
import ca.aegis.control.reservation.LocalAuthorization.Authorized;
import ca.aegis.control.reservation.LocalAuthorization.Refused;
import ca.aegis.control.shared.idempotency.IdempotencyService;
import ca.aegis.control.shared.idempotency.IdempotentRequest;
import ca.aegis.control.shared.idempotency.IdempotentResource;
import ca.aegis.control.shared.idempotency.IdempotentResult;
import ca.aegis.control.shared.web.ApiError;
import ca.aegis.control.shared.web.Problems;
import ca.aegis.control.shared.web.ResourceNotFoundException;

/**
 * Document 09, section 15.4: the initiator follows an operation by polling it. Another user's operation is not
 * visible, so it is not found (section 26.2). The view never carries a secret of the challenge.
 */
@RestController
class LockerOperationController {

    /** Document 09, section 15.5: a strict size limit; a valid body is about 110 bytes. */
    static final int MAX_AUTHORIZE_BODY = 512;

    private final LockerOperationReads operations;
    private final LocalAuthorization authorization;
    private final IdempotencyService idempotency;
    private final Problems problems;
    private final JsonMapper jsonMapper;

    LockerOperationController(LockerOperationReads operations, LocalAuthorization authorization,
            IdempotencyService idempotency, Problems problems, JsonMapper jsonMapper) {
        this.operations = operations;
        this.authorization = authorization;
        this.idempotency = idempotency;
        this.problems = problems;
        this.jsonMapper = jsonMapper;
    }

    /**
     * Document 09, section 15.5. The body is read as text so that any malformed body, whatever the defect, is
     * {@code LOCAL_PROOF_MALFORMED}. A refusal that changed state (a counted wrong secret, an attempt ended) is
     * recorded with the key: its replay returns the same problem without counting again.
     */
    @PostMapping("/api/v1/locker-operations/{operationId}/authorize-local")
    ResponseEntity<JsonNode> authorizeLocal(IdempotentRequest idempotentRequest, @PathVariable UUID operationId,
            @RequestBody(required = false) String body, HttpServletRequest request) {
        AuthorizeLocalRequest proof = parse(body);
        return idempotency.execute(idempotentRequest, proof, () -> {
            byte[] token = LocalAuthorization.decodeToken(proof.token());
            try {
                return switch (authorization.authorize(idempotentRequest.actorUserId(), operationId,
                        proof.challengeId(), token)) {
                    case Authorized authorized -> IdempotentResult.accepted(IdempotentResource.LOCKER_OPERATION,
                            authorized.operation().id(), authorized.operation());
                    case Refused refused -> IdempotentResult.refused(problems.body(refused.error(),
                            refused.error().status().value(), request, null, null));
                };
            } finally {
                LocalAuthorization.clear(token);
            }
        });
    }

    private AuthorizeLocalRequest parse(String body) {
        if (body == null || body.length() > MAX_AUTHORIZE_BODY) {
            throw new ReservationRefusedException(ApiError.LOCAL_PROOF_MALFORMED);
        }
        JsonNode node;
        try {
            node = jsonMapper.readTree(body);
        } catch (JacksonException malformed) {
            throw new ReservationRefusedException(ApiError.LOCAL_PROOF_MALFORMED);
        }
        if (node == null || !node.isObject() || node.size() != 2 || !node.path("challengeId").isString()
                || !node.path("token").isString()) {
            throw new ReservationRefusedException(ApiError.LOCAL_PROOF_MALFORMED);
        }
        for (Iterator<String> names = node.propertyNames().iterator(); names.hasNext();) {
            String name = names.next();
            if (!"challengeId".equals(name) && !"token".equals(name)) {
                throw new ReservationRefusedException(ApiError.LOCAL_PROOF_MALFORMED);
            }
        }
        UUID challengeId;
        try {
            challengeId = UUID.fromString(node.path("challengeId").asString());
        } catch (IllegalArgumentException malformed) {
            throw new ReservationRefusedException(ApiError.LOCAL_PROOF_MALFORMED);
        }
        String token = node.path("token").asString();
        LocalAuthorization.clear(LocalAuthorization.decodeToken(token));
        return new AuthorizeLocalRequest(challengeId, token);
    }

    @GetMapping("/api/v1/locker-operations/{operationId}")
    ResponseEntity<LockerOperationView> get(@AuthenticationPrincipal CurrentAccount technician,
            @PathVariable UUID operationId) {
        LockerOperationView view = operations.find(operationId)
                .filter(operation -> operation.userId().equals(technician.id()))
                .orElseThrow(ResourceNotFoundException::new);
        ResponseEntity.BodyBuilder response = ResponseEntity.ok().cacheControl(CacheControl.noStore());
        if (view.requiredAction() != RequiredAction.NONE) {
            response.header(HttpHeaders.RETRY_AFTER, "1");
        }
        return response.body(view);
    }
}
