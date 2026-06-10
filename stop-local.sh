#!/bin/bash
# Stop local ARC dev server
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

stop_pid() {
    local file=$1
    local name=$2
    if [[ -f "$file" ]]; then
        pid=$(cat "$file")
        if kill -0 "$pid" 2>/dev/null; then
            echo "Stopping $name (PID $pid)..."
            kill "$pid" 2>/dev/null || true
            sleep 1
            kill -9 "$pid" 2>/dev/null || true
        fi
        rm -f "$file"
    fi
}

stop_pid "$ROOT/logs/backend.pid" "backend"
stop_pid "$ROOT/logs/frontend.pid" "frontend"

# Cleanup orphan processes
for port in 8001 3000; do
    pid=$(lsof -ti:$port 2>/dev/null || true)
    [[ -n "$pid" ]] && kill -9 $pid 2>/dev/null && echo "Killed orphan on port $port"
done

echo "✓ ARC stopped."
