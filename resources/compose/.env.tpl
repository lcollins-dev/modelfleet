# Copy this file to .env and fill every value before `docker compose up`. Generate each secret
# with `openssl rand -hex 32`.

# Signs every session token, so it must be at least 32 characters. Changing it signs everyone out.
USER_TOKEN_SECRET=

# The password of the modelfleet database user. Postgres applies it only when the database volume
# is first created.
TYPEORM_PASSWORD=

# The group owning the host's Docker socket, from `stat -c %g /var/run/docker.sock`.
DOCKER_GID=
