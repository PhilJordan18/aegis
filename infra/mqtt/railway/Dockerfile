FROM eclipse-mosquitto@sha256:38c0da4f2ef84284d47b3b3eeea1cb3bdeabe81ee10caf0cd5c5ff61ee3ea408
COPY infra/mqtt/acl /opt/aegis/base.acl
COPY infra/mqtt/railway/install-recipe-overlay.sh infra/mqtt/railway/entrypoint.sh infra/mqtt/railway/mosquitto.conf /opt/aegis/
RUN mkdir -p /run/aegis-mqtt && chown mosquitto:mosquitto /run/aegis-mqtt /mosquitto/data && chmod 0700 /run/aegis-mqtt
USER mosquitto
ENTRYPOINT ["sh", "/opt/aegis/entrypoint.sh"]
