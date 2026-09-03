---
name: aegis-postgres
description: Design and evolve the Aegis PostgreSQL schema and Flyway migrations for integrity, concurrency, auditability, rollback planning, and measured query performance.
---

# Aegis PostgreSQL Engineering

## Database role

PostgreSQL protects durable business facts and invariants.

It is not directly accessible by React, iOS, or ESP32.

## Schema design

Use:

- explicit primary keys;
- foreign keys;
- meaningful uniqueness constraints;
- non-null constraints for required facts;
- UTC timestamps;
- check constraints for stable local invariants;
- indexes driven by real access patterns.

Preserve history required for chain of custody.

Do not use cascading deletion where it could erase audit, loan, reservation, command, event, or operation history.

Prefer archival or explicit lifecycle transitions over destructive deletion.

## Critical constraints

Provide database-level protection for:

- one active reservation per asset;
- one active loan per asset;
- unique processed message identifiers;
- unique operation identifiers;
- valid compartment ownership;
- stable device identifiers;
- non-duplicated audit identity.

PostgreSQL partial unique indexes may be used for active-state uniqueness when appropriate.

Application checks do not replace constraints.

## Transactions and concurrency

For each concurrent workflow, document:

- rows read;
- rows written;
- expected lock order;
- isolation assumptions;
- retry behavior;
- possible deadlocks;
- final database constraint.

Write concurrency tests for reservation, checkout, loan creation, and duplicate events.

Do not hold database transactions open while waiting for physical activity or MQTT delivery.

## Flyway

- Every schema change uses Flyway.
- Never edit an already-shared migration.
- Create a forward migration to correct a shared migration.
- Make deployments safe for the expected application rollout order.
- Include a rollback or recovery plan even when rollback is another forward migration.
- Back up and obtain explicit approval before destructive production-like changes.
- Keep deterministic demo seed data separate from production behavior.

## Query performance

Before optimization:

1. identify the real query;
2. capture query count and latency;
3. inspect `EXPLAIN (ANALYZE, BUFFERS)` in a representative environment;
4. identify cardinality and selectivity;
5. change one relevant factor;
6. measure again.

Review JPA behavior with the backend owner.

Do not add indexes blindly. Account for write cost and duplicated indexes.

## Data safety

Never:

- manually patch data as the normal demo flow;
- disable constraints to make tests pass;
- expose PostgreSQL publicly;
- store plaintext secrets;
- erase custody or audit history without explicit authorization.