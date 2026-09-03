---
name: aegis-spring-security
description: Build and secure the Aegis Spring Boot modular monolith with authoritative domain logic, explicit transactions, idempotent operations, and verifiable authorization.
---

# Aegis Spring and Security

## Architecture

Keep the backend as a modular monolith organized by feature:

- `identity`
- `asset`
- `readiness`
- `reservation`
- `loan`
- `locker`
- `operation`
- `device`
- `audit`
- `shared`

Do not create microservices for P0.

Prevent circular feature dependencies. Keep domain rules out of controllers and transport adapters.

## API boundary

- Use DTOs instead of exposing JPA entities.
- Validate input at the boundary.
- Return structured error codes.
- Keep clients unaware of persistence structure.
- Reject impossible transitions explicitly.
- Inject a controllable `Clock` for expiration logic.

## Authentication and authorization

P0 roles:

- `ADMIN`
- `TECHNICIAN`

Requirements:

- hash passwords using a proven Spring Security mechanism;
- use expiring authentication tokens;
- apply authorization server-side;
- validate asset access level during readiness and checkout;
- reject expired, consumed, or mismatched operations;
- never log credentials, tokens, or sensitive secrets;
- keep demo accounts explicit and environment-specific.

Follow the approved authentication ADR. Do not improvise persistent token storage behavior.

## Transactions and concurrency

Define transaction boundaries at application-service use cases.

Protect:

- one active reservation per asset;
- one active loan per asset;
- operation terminality;
- reservation fulfillment;
- physical confirmation;
- idempotent event consumption.

Use database constraints as the final protection.

Select optimistic or pessimistic locking based on the actual race, and document the reason.

Avoid long transactions around MQTT or network calls.

## Persistence performance

- Avoid accidental lazy loading during serialization.
- Detect N+1 queries.
- Use explicit fetch strategies or projections.
- Paginate collection endpoints.
- Measure queries before adding indexes or caches.
- Do not enable broad eager fetching as a shortcut.

## MQTT integration

Keep MQTT transport logic in adapters.

Persist or otherwise durably identify processed messages before applying duplicate-sensitive transitions.

Do not grant authorization based on an ESP32 claim.

Separate:

- command creation;
- publication;
- acknowledgement;
- observation handling;
- business confirmation;
- timeout and anomaly handling.

If delivery consistency requires a transactional outbox or inbox, evaluate it explicitly and document the tradeoff.

## Testing

Include as applicable:

- unit tests for domain transitions;
- authorization-negative tests;
- controller/API tests;
- PostgreSQL integration tests;
- concurrency tests;
- duplicate-message tests;
- transaction rollback tests;
- expiration tests using a controlled clock;
- MQTT adapter tests.

A happy-path controller test is not sufficient evidence for a custody workflow.