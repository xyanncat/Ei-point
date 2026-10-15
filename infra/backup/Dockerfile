FROM postgres:17.5
RUN apt-get update && apt-get install -y --no-install-recommends pgbackrest \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/pgbackrest /var/log/pgbackrest \
    && chown postgres:postgres /var/lib/pgbackrest /var/log/pgbackrest
COPY infra/backup/pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
