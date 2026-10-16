#!/bin/bash
set -e

source "$(dirname "$0")/env.sh"

mkdir -p "$LOG_DIR"
mkdir -p "$MODEL_DIR"

start_app() {
  local name=$1
  local pid_file="$LOG_DIR/${name}.pid"
  local log_file="$LOG_DIR/${name}.log"

  if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
    echo "${name}: already running (PID $(cat "$pid_file"))"
    return
  fi

  : > "$log_file"
  if [[ "$name" == "server" ]]; then
    PORT=$SERVER_PORT GATEWAY_PORT=$GATEWAY_PORT \
      setsid bash -c "npm run start --workspace=apps/${name}" > "$log_file" 2>&1 &
  elif [[ "$name" == "agent" ]]; then
    local model_dirs=()

    # A variable set here beats development.env, so it is passed only where the file sets none
    if ! grep -q '^MODEL_DIRS=' "$WORKTREE_DIR/apps/agent/development.env" 2>/dev/null; then
      model_dirs=(MODEL_DIRS="$MODEL_DIR")
    fi

    env SERVER_URL="http://localhost:${SERVER_PORT}" NODE_KEY="$DEV_NODE_KEY" "${model_dirs[@]}" RELAY_PORT=$RELAY_PORT \
      setsid bash -c "npm run start --workspace=apps/${name}" > "$log_file" 2>&1 &
  else
    setsid bash -c "npm run start --workspace=apps/${name}" > "$log_file" 2>&1 &
  fi

  echo $! > "$pid_file"
  echo "${name}: started (PID $!, log: .workdir/logs/${name}.log)"
}

echo ""
echo "Starting all apps for instance ${INSTANCE}"

for app in server agent; do
  dev_env="$WORKTREE_DIR/apps/${app}/development.env"

  if [[ ! -f "$dev_env" ]]; then
    cp "$dev_env.tpl" "$dev_env"
    echo "Created apps/${app}/development.env from development.env.tpl"

    if [[ "$app" == "server" ]]; then
      sed -i "s/^USER_TOKEN_SECRET=$/USER_TOKEN_SECRET=$(openssl rand -hex 32)/" "$dev_env"
    fi
  fi
done

bash "$(dirname "$0")/db-up.sh"

start_app server
start_app agent
start_app web

echo ""
echo "Instance ${INSTANCE} running"
echo "  Web: http://localhost:${WEB_PORT}"
echo ""
echo "  Ports - server:${SERVER_PORT} gateway:${GATEWAY_PORT} web:${WEB_PORT} db:${DB_PORT} relay:${RELAY_PORT}"
echo ""
