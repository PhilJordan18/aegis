package ca.aegis.control.shared.web;

/** A resource that is absent or not visible to the caller (document 09, section 21). */
public final class ResourceNotFoundException extends ApiException {

    public ResourceNotFoundException() {
        super(ApiError.RESOURCE_NOT_FOUND);
    }
}
