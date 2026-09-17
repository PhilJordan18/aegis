# Architecture globale

Acteurs et grands blocs du système Aegis : technicien, administrateur, application iOS, administration React, backend Spring Boot, PostgreSQL, broker MQTT et le locker ESP32.

Ce diagramme est la version canonique — la même que celle intégrée dans la section « Architecture du système » du [`README.md`](../../README.md). Style et palette définis dans le skill [`aegis-hardware-diagrams`](../../.claude/skills/aegis-hardware-diagrams/SKILL.md) (section « System / actor architecture style »); ne pas renommer les blocs sans mettre à jour les deux emplacements.

```mermaid
flowchart TD
    TECH["Technicien"]:::persona
    ADMIN["Administrateur"]:::persona
    IOS["Aegis Mobile<br/>SwiftUI"]:::software
    WEB["Aegis Manager<br/>React"]:::software
    API["Aegis Control<br/>Spring Boot"]:::software
    DB[("PostgreSQL")]:::infra
    BROKER["Broker MQTT"]:::infra
    NODE["Aegis Locker Node<br/>ESP32"]:::hardware

    TECH -->|utilise| IOS
    ADMIN -->|utilise| WEB
    IOS -->|HTTPS| API
    WEB -->|HTTPS| API
    API --> DB
    API <-->|MQTT sécurisé| BROKER
    BROKER <-->|Commandes et événements| NODE

    classDef persona fill:#2B2440,stroke:#9F91F0,color:#EDE9FE
    classDef software fill:#0F2C46,stroke:#58A6FF,color:#D6E8FB
    classDef infra fill:#2A2A2E,stroke:#9CA3AF,color:#E6EDF3
    classDef hardware fill:#3A2A0E,stroke:#D9A441,color:#FCEACD
```

## Légende des catégories

| Catégorie | Contenu |
|---|---|
| Persona (violet) | Technicien, Administrateur |
| Logiciel (bleu) | Aegis Mobile, Aegis Manager, Aegis Control |
| Infra (gris) | PostgreSQL, Broker MQTT |
| Matériel (ambre) | Aegis Locker Node (ESP32) |

## Règles de confiance représentées

- Le Web et le mobile ne parlent qu'à `Aegis Control` — jamais directement à PostgreSQL ni au locker.
- `Aegis Control` est la seule autorité métier; le broker et le locker ne font que transporter et exécuter des commandes déjà autorisées.
- Le nœud reste nommé « Aegis Locker Node » plutôt que « hub/cellule » : cette architecture matérielle est encore soumise au POC de [`scope.md` §17.5](../cahier-conception/scope.md) et n'est pas un engagement du P0.
