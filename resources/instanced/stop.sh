#!/bin/bash

source "$(dirname "$0")/env.sh"

stop_app() {
  local name=$1
  local pid_file="$LOG_DIR/${name}.pid"

  if [[ ! -f "$pid_file" ]]; then
    return
  fi

  local pid
  pid=$(cat "$pid_file")

  if kill -0 "$pid" 2>/dev/null; then
    echo "${name}: stopping (PID ${pid})..."
    kill -- -"$pid" 2>/dev/null || true

    # A restart straight after would otherwise find the port still taken.
    for _ in {1..5}; do
      if ! kill -0 -- -"$pid" 2>/dev/null; then
        break
      fi

      sleep 1
    done

    if kill -0 -- -"$pid" 2>/dev/null; then
      kill -KILL -- -"$pid" 2>/dev/null || true
    fi
  fi

  rm -f "$pid_file"
}

if [[ -n "$1" ]]; then
  stop_app "$1"
else
  stop_app server
  stop_app agent
  stop_app web

  bash "$(dirname "$0")/db-down.sh"
fi
