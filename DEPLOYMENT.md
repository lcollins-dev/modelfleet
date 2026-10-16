# Deploying Modelfleet

Modelfleet is two images and a database, run from one compose file:

- The **server** provides the console, the management API and the OpenAI-compatible gateway, and keeps fleet state in
  Postgres. It listens on port 8080 for the console and API, and 3030 for the gateway.
- The **agent** runs on each GPU machine. It holds that machine's GPUs, model files and Docker socket, and runs the
  inference backends as containers.

You need Docker with the NVIDIA Container Toolkit on each GPU machine, and a reverse proxy that handles HTTPS.

## Install

1. Copy the `resources/compose` directory to the host: `docker-compose.yml`, `.env.tpl`, `server.env` and
   `agent.env`.

2. Copy `.env.tpl` to `.env` and fill every value:

   | Setting             | Value                                                                                |
   | ------------------- | ------------------------------------------------------------------------------------ |
   | `USER_TOKEN_SECRET` | `openssl rand -hex 32`. Signs sign-in tokens. Changing it later signs everyone out.  |
   | `TYPEORM_PASSWORD`  | `openssl rand -hex 32`. The database password.                                       |
   | `DOCKER_GID`        | `stat -c %g /var/run/docker.sock`. The group owning the Docker socket, on this host. |

3. In `server.env`, set `WEB_APP_BASE_URL` to your public console URL and `TRUST_PROXY` to your proxy's address, or
   `loopback, linklocal, uniquelocal` for a proxy on the same host. Change `EMAIL_FROM_ADDRESS` if you want
   welcome emails, see [Email](#email).

4. Make sure only the proxy can reach ports 8080 and 3030. For a proxy on the same host, change the compose `ports` to
   `127.0.0.1:8080:3000` and `127.0.0.1:3030:3030`.

5. Start the server and database. Leaving `MODELFLEET_VERSION` unset runs the latest release. To pin a
   [release](https://github.com/lcollins-dev/modelfleet/releases), set its version without the `v`:

   ```sh
   MODELFLEET_VERSION=1.2.3 docker compose up -d
   ```

6. Point your reverse proxy at port 8080 for the console and 3030 for the gateway. See
   [Reverse proxy](#reverse-proxy) for what it must do.

7. Sign in as `admin@modelfleet.test` with password `changeme`. The console asks for a new email and password before
   anything else, so do this before anyone else can reach it. To sign in before enabling the proxy, use
   `http://localhost:8080` on the host or an SSH tunnel:

   ```sh
   ssh -L 8080:127.0.0.1:8080 your-server
   ```

8. Register the node. Open **Nodes**, choose **Register node** and copy the key and secret from the dialog. The secret
   is shown once. Put them in `agent.env` as `NODE_KEY` and `NODE_SECRET`, then run `docker compose up -d` again.

The node reads as **Awaiting first contact** until the agent connects. Its GPUs and model files then appear on the
node's page.

## Reverse proxy

Your reverse proxy must:

- Serve the console over HTTPS at the root of its own hostname, matching `WEB_APP_BASE_URL`
- Accept request bodies of 8 MB on the console and 32 MB on the gateway
- Pass streamed responses through without buffering
- Let gateway requests wait for `GATEWAY_LOAD_WAIT_TIMEOUT`, 15 minutes by default, while a model loads
- Set `X-Forwarded-For` to the client's address and be named in `TRUST_PROXY`, which rate limiting relies on
- Keep the `Authorization` header out of its logs, since it carries sign-in tokens and API keys

An example nginx config, with the gateway on a second hostname:

```nginx
server {
  listen 443 ssl;
  server_name fleet.example.com;
  ssl_certificate /path/to/fullchain.pem;
  ssl_certificate_key /path/to/privkey.pem;

  client_max_body_size 8m;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
  }
}

server {
  listen 443 ssl;
  server_name inference.example.com;
  ssl_certificate /path/to/fullchain.pem;
  ssl_certificate_key /path/to/privkey.pem;

  client_max_body_size 32m;

  location / {
    proxy_pass http://127.0.0.1:3030;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 15m;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

## Adding GPU machines

Run the `agent` service from the compose file on each additional GPU machine, with the Docker socket, host PID
namespace, GPUs and models volume as in the compose file. In its `agent.env`:

- Set `SERVER_URL` to where the agent reaches the server, as an `http`, `https`, `ws` or `wss` URL. The agent connects
  out, so the server never needs to reach it to manage it.
- Set `RELAY_ADVERTISE_URL` to where the server reaches the agent's inference relay on port 3040. The server reaches it
  for inference.
- Register the node and set `NODE_KEY` and `NODE_SECRET` as in the install steps.

The agent holds the host's Docker socket, which is root-equivalent on that host, and sees every host process. No other
container does.

## Model files

The agent writes Hugging Face downloads to the first directory in `MODEL_DIRS`, `/var/lib/modelfleet/models` in the
image. The compose file keeps it in a `models` volume.

The agent runs as uid 1000. A host directory mapped in place of the volume must be writable by that uid and not mounted
`:ro`. Run `chown -R 1000:1000` on it if downloads fail with a permissions error.

Model files you already have can be mapped into the container at another path and listed in `MODEL_DIRS` after the
download directory. The agent scans every directory in the list.

## Upgrading

The server and agent share a version. Upgrade every host to the same `MODELFLEET_VERSION`, and replace the compose
files with those from the release first, adding any new `.env.tpl` values to `.env`.

The server migrates its database on startup and migrations cannot be undone, so back up Postgres first:

```sh
docker compose exec db pg_dump -U modelfleet modelfleet > modelfleet.sql
```

Then pull and restart:

```sh
MODELFLEET_VERSION=1.2.3 docker compose pull
MODELFLEET_VERSION=1.2.3 docker compose up -d
```

## Settings

The server reads `server.env` and each agent reads `agent.env`. Both validate every setting at startup.

### Server

| Setting                     | Default                  | Description                                                                             |
| --------------------------- | ------------------------ | --------------------------------------------------------------------------------------- |
| `WEB_APP_BASE_URL`          |                          | Required. Your public console URL, e.g. `https://fleet.example.com`, no trailing slash. |
| `TYPEORM_HOST`              |                          | Required. The Postgres host. `db` in the compose file.                                  |
| `EMAIL_FROM_ADDRESS`        |                          | Required. The address emails are sent from.                                             |
| `TRUST_PROXY`               | `false`                  | Your proxy's address, or `loopback, linklocal, uniquelocal` for one on the same host.   |
| `TYPEORM_PORT`              | `5432`                   | Postgres port.                                                                          |
| `TYPEORM_USERNAME`          | `modelfleet`             | Postgres user.                                                                          |
| `TYPEORM_DATABASE`          | `modelfleet`             | Postgres database.                                                                      |
| `TYPEORM_USE_SSL`           | `false`                  | Connect to Postgres over TLS.                                                           |
| `TYPEORM_MIGRATIONS_RUN`    | `false`                  | Update the database schema at start. The compose file turns it on.                      |
| `HUGGINGFACE_TOKEN`         |                          | A Hugging Face token (`hf_...`) for downloading from private or gated repositories.     |
| `HUGGINGFACE_ENDPOINT`      | `https://huggingface.co` | The Hub to list and download from.                                                      |
| `USER_TOKEN_EXPIRY`         | `24h`                    | How long a sign-in lasts.                                                               |
| `USER_IDLE_TIMEOUT`         | `1h`                     | How long a signed-in user may be idle before they are signed out.                       |
| `NODE_OFFLINE_THRESHOLD`    | `30s`                    | How long without a heartbeat before a node reads as offline.                            |
| `SCHEDULER_IDLE_TIMEOUT`    | `15m`                    | How long an on-demand deployment idles before it is stopped.                            |
| `GATEWAY_LOAD_WAIT_TIMEOUT` | `15m`                    | How long a gateway request waits for its model to load.                                 |
| `LOG_STDOUT_LEVEL`          | `info`                   | Log level for container output.                                                         |
| `LOG_FILE_PATH`             | `logs`                   | Directory for the log file. Blank, as in the compose file, turns file logging off.      |

### Email

Email is only used for the welcome message an admin can choose to send when creating a user. The server sends through
SMTP when `EMAIL_SMTP_HOST` is set, and through Amazon SES otherwise. A failed send is logged and the request still
succeeds, so an install without email works fine.

| Setting                       | Default     | Description                                                               |
| ----------------------------- | ----------- | ------------------------------------------------------------------------- |
| `EMAIL_SMTP_HOST`             |             | SMTP server. Leave empty to send through SES instead.                     |
| `EMAIL_SMTP_PORT`             | `587`       | SMTP port. 587 uses STARTTLS. For 465, also set `EMAIL_SMTP_SECURE=true`. |
| `EMAIL_SMTP_SECURE`           | `false`     | Use implicit TLS (port 465).                                              |
| `EMAIL_SMTP_STARTTLS`         | `true`      | Upgrade the connection with STARTTLS.                                     |
| `EMAIL_SMTP_USERNAME`         |             | SMTP username. Leave empty if your server doesn't need one.               |
| `EMAIL_SMTP_PASSWORD`         |             | SMTP password.                                                            |
| `EMAIL_SES_REGION`            | `eu-west-2` | SES region.                                                               |
| `EMAIL_SES_ACCESS_KEY_ID`     |             | SES access key.                                                           |
| `EMAIL_SES_SECRET_ACCESS_KEY` |             | SES secret key.                                                           |

### Agent

| Setting               | Default                      | Description                                                                                     |
| --------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `SERVER_URL`          |                              | Required. Where the agent reaches the server. `http://server:3000` in the compose file.         |
| `NODE_KEY`            |                              | Required. Issued when the node is registered.                                                   |
| `NODE_SECRET`         |                              | Required. Issued with the key, and shown once.                                                  |
| `RELAY_ADVERTISE_URL` | `http://localhost:3040`      | Where the server reaches this agent's inference relay. `http://agent:3040` in the compose file. |
| `MODEL_DIRS`          | `/var/lib/modelfleet/models` | Comma-separated directories to scan for model files. Downloads land in the first one.           |
| `RELAY_PORT`          | `3040`                       | The port the inference relay listens on.                                                        |
| `DOCKER_SOCKET_PATH`  | `/var/run/docker.sock`       | The Docker socket the agent starts backends through.                                            |
| `INSTANCE_NETWORK`    | `modelfleet-instances`       | The Docker network backends are attached to. Nothing outside it reaches one.                    |
| `GPU_HEADROOM_MIB`    | `1024`                       | Memory left free on each card when a start is admitted.                                         |
| `GPU_READER_INTERVAL` | `5s`                         | How often GPU readings are taken.                                                               |
| `LOG_LEVEL`           | `info`                       | Log level for container output.                                                                 |
