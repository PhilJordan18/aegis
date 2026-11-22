-- ADR-016 (#178): revocable browser sessions of the Manager. Only a SHA-256 digest of the cookie value is stored,
-- so a database read never yields a usable credential. A session has an absolute end fixed at sign-in; refreshing
-- it never moves that end. Rows are credentials, not custody history: an ended row may be deleted.

CREATE TABLE aegis.browser_sessions (
    id                 uuid PRIMARY KEY DEFAULT public.gen_random_uuid(),
    user_id            uuid NOT NULL,
    token_hash         bytea NOT NULL,
    role               text NOT NULL,
    created_at         timestamptz NOT NULL,
    expires_at         timestamptz NOT NULL,
    last_refreshed_at  timestamptz NULL,
    revoked_at         timestamptz NULL,
    revocation_reason  text NULL,

    CONSTRAINT fk_browser_sessions_user
        FOREIGN KEY (user_id) REFERENCES aegis.users (id),
    CONSTRAINT uq_browser_sessions_token_hash
        UNIQUE (token_hash),
    CONSTRAINT ck_browser_sessions_token_hash_length
        CHECK (octet_length(token_hash) = 32),
    CONSTRAINT ck_browser_sessions_role
        CHECK (role IN ('ADMIN', 'TECHNICIAN')),
    CONSTRAINT ck_browser_sessions_lifetime
        CHECK (expires_at > created_at AND expires_at <= created_at + interval '12 hours'),
    CONSTRAINT ck_browser_sessions_revocation
        CHECK ((revoked_at IS NULL) = (revocation_reason IS NULL)),
    CONSTRAINT ck_browser_sessions_revocation_reason
        CHECK (revocation_reason IS NULL
            OR revocation_reason IN ('SIGNED_OUT', 'ACCOUNT_CHANGED'))
);

CREATE INDEX ix_browser_sessions_user ON aegis.browser_sessions (user_id);
