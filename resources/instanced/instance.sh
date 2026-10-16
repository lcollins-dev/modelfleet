#!/bin/bash
# Prints this worktree's instance number, allocating one on first use.
#
# Numbering by position in `git worktree list` is not stable: removing an earlier worktree shifts
# every later one down, moving the ports and database out from under a running instance. Instead,
# allocate the lowest number no other worktree holds and record it in `.workdir/instance` at the
# worktree root, so a worktree keeps the same number for its whole life.

set -e

WORKTREE_DIR=$(git rev-parse --show-toplevel)
INSTANCE_FILE="$WORKTREE_DIR/.workdir/instance"

# A file that is missing, or that holds anything but a positive number, counts as no claim.
read_instance() {
  if [[ ! -f "$1" ]]; then
    return 1
  fi

  local value
  value=$(tr -d '[:space:]' < "$1")

  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    return 1
  fi

  echo "$value"
}

# The main worktree is reserved instance 1 - there is only ever one of it, and this keeps the
# ports and database of the primary checkout where they have always been.
#
# git reports --git-dir and --git-common-dir relative to the working directory, so both are
# resolved absolute to stay comparable from any directory.
GIT_DIR_ABS=$(git rev-parse --path-format=absolute --git-dir)
GIT_COMMON_DIR_ABS=$(git rev-parse --path-format=absolute --git-common-dir)

if [[ "$GIT_DIR_ABS" == "$GIT_COMMON_DIR_ABS" ]]; then
  echo 1
  exit 0
fi

if read_instance "$INSTANCE_FILE"; then
  exit 0
fi

claimed=$(git worktree list --porcelain | while read -r key path; do
  if [[ "$key" == 'worktree' ]]; then
    read_instance "$path/.workdir/instance" || true
  fi
done)

instance=2
while grep -qx "$instance" <<< "$claimed"; do
  instance=$((instance + 1))
done

mkdir -p "$(dirname "$INSTANCE_FILE")"
echo "$instance" > "$INSTANCE_FILE"
echo "$instance"
