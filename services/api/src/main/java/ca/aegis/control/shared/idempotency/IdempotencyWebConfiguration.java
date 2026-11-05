package ca.aegis.control.shared.idempotency;

import java.util.List;
import java.util.Map;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.context.annotation.Configuration;
import org.springframework.core.MethodParameter;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.firewall.RequestRejectedException;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import ca.aegis.control.identity.CurrentAccount;
import ca.aegis.control.shared.web.InvalidRequestException;
import ca.aegis.control.shared.web.PlainText;

@Configuration(proxyBeanMethods = false)
class IdempotencyWebConfiguration implements WebMvcConfigurer {

    private static final String API_PREFIX = "/api/v1";

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(new IdempotentRequestResolver());
    }

    /**
     * Builds the {@link IdempotentRequest} of the matched handler. Declared before the body parameter, it refuses a
     * missing or blank key with {@code IDEMPOTENCY_KEY_REQUIRED}, and a key over 128 characters or holding a control
     * character with {@code VALIDATION_ERROR}, before the body is read and before the key reaches PostgreSQL. The
     * actor comes from the authenticated account, never from the request.
     */
    static final class IdempotentRequestResolver implements HandlerMethodArgumentResolver {

        @Override
        public boolean supportsParameter(MethodParameter parameter) {
            return parameter.getParameterType() == IdempotentRequest.class;
        }

        @Override
        public IdempotentRequest resolveArgument(MethodParameter parameter, ModelAndViewContainer container,
                NativeWebRequest webRequest, WebDataBinderFactory binderFactory) {
            HttpServletRequest request = webRequest.getNativeRequest(HttpServletRequest.class);
            String key = requireKey(keyHeader(request));
            return new IdempotentRequest(currentActor().id(), key, request.getMethod(), logicalRoute(request),
                    pathParameters(request));
        }

        static String requireKey(String header) {
            if (header == null || header.isBlank()) {
                throw new IdempotencyExceptions.KeyRequired();
            }
            if (header.length() > IdempotentRequest.MAX_KEY_LENGTH) {
                throw InvalidRequestException.of(IdempotentRequest.HEADER, "SIZE",
                        "La clé d'idempotence dépasse 128 caractères.");
            }
            if (!PlainText.Validator.isPlain(header, false)) {
                throw forbiddenCharacter();
            }
            return header;
        }

        /**
         * The security firewall checks a header value only when it is read, and refuses most control characters
         * there; that refusal is the same invalid key, not a server error.
         */
        private static String keyHeader(HttpServletRequest request) {
            try {
                return request.getHeader(IdempotentRequest.HEADER);
            } catch (RequestRejectedException rejected) {
                throw forbiddenCharacter();
            }
        }

        private static InvalidRequestException forbiddenCharacter() {
            return InvalidRequestException.of(IdempotentRequest.HEADER, "INVALID_VALUE",
                    "La clé d'idempotence contient un caractère non autorisé.");
        }

        /** Only reachable through a mapping error: every idempotent route requires an authenticated role. */
        private static CurrentAccount currentActor() {
            Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
            if (authentication != null && authentication.getPrincipal() instanceof CurrentAccount account) {
                return account;
            }
            throw new IllegalStateException("An idempotent route requires an authenticated account");
        }

        private static String logicalRoute(HttpServletRequest request) {
            if (!(request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE) instanceof String pattern)) {
                throw new IllegalStateException("No matched route template for " + request.getRequestURI());
            }
            return pattern.startsWith(API_PREFIX + "/") ? pattern.substring(API_PREFIX.length()) : pattern;
        }

        @SuppressWarnings("unchecked")
        private static Map<String, String> pathParameters(HttpServletRequest request) {
            Object variables = request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
            return variables instanceof Map<?, ?> map ? (Map<String, String>) map : Map.of();
        }
    }
}
