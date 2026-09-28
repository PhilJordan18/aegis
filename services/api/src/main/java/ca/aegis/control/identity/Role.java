package ca.aegis.control.identity;

/** Application role. An administrator is not implicitly a technician (document 09, section 5). */
public enum Role {
    ADMIN,
    TECHNICIAN;

    public String authority() {
        return "ROLE_" + name();
    }
}
