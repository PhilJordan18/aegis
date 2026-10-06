package ca.aegis.control.shared.web;

import java.util.List;

import org.springframework.context.annotation.Configuration;
import org.springframework.core.MethodParameter;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration(proxyBeanMethods = false)
class WebConfiguration implements WebMvcConfigurer {

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(new IdempotencyKeyResolver());
    }

    private static final class IdempotencyKeyResolver implements HandlerMethodArgumentResolver {

        @Override
        public boolean supportsParameter(MethodParameter parameter) {
            return parameter.getParameterType() == IdempotencyKey.class;
        }

        @Override
        public IdempotencyKey resolveArgument(MethodParameter parameter, ModelAndViewContainer container,
                NativeWebRequest request, WebDataBinderFactory binderFactory) {
            return IdempotencyKey.require(request.getHeader(IdempotencyKey.HEADER));
        }
    }
}
