#!/bin/sh
set -eu

case "${CHROME_FLAVOR:-headless-shell}" in
  headless-shell) chrome=/opt/chrome-headless-shell-linux64/chrome-headless-shell ;;
  chrome) chrome=/opt/chrome-linux64/chrome ;;
  *) echo "Unknown CHROME_FLAVOR: ${CHROME_FLAVOR}" >&2; exit 64 ;;
esac
: "${AUDIT_FIXTURE_PORT:?AUDIT_FIXTURE_PORT is required}"
fixture_ip=$(getent ahostsv4 host.docker.internal | awk 'NR == 1 { print $1 }')
dns_ip=$(awk '/^nameserver / { print $2; exit }' /etc/resolv.conf)
[ -n "$fixture_ip" ] || { echo "host.docker.internal did not resolve" >&2; exit 1; }
[ -n "$dns_ip" ] || { echo "Container DNS server is not configured" >&2; exit 1; }
iptables --flush
iptables --policy OUTPUT DROP
ip6tables --flush
ip6tables --policy OUTPUT DROP
iptables --append OUTPUT --out-interface lo --jump ACCEPT
iptables --append OUTPUT --match conntrack --ctstate ESTABLISHED,RELATED --jump ACCEPT
iptables --append OUTPUT --destination "$dns_ip" --protocol udp --dport 53 --jump ACCEPT
iptables --append OUTPUT --destination "$dns_ip" --protocol tcp --dport 53 --jump ACCEPT
iptables --append OUTPUT --destination "$fixture_ip" --protocol tcp --dport "$AUDIT_FIXTURE_PORT" --jump ACCEPT

run_as_chrome() {
  exec env HOME=/home/chrome XDG_CONFIG_HOME=/home/chrome/.config XDG_CACHE_HOME=/home/chrome/.cache setpriv --reuid chrome --regid chrome --init-groups --bounding-set=-all --ambient-caps=-all --inh-caps=-all "$@"
}

run_as_chrome "$chrome" \
  --headless=new \
  --disable-gpu \
  --no-first-run \
  --no-default-browser-check \
  --no-sandbox \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9223 \
  --user-data-dir="${CHROME_USER_DATA_DIR:-/tmp/chrome-profile}" \
  about:blank \
  "$@" &
chrome_pid=$!
trap 'kill "$chrome_pid" 2>/dev/null || true; wait "$chrome_pid" 2>/dev/null || true; exit 0' INT TERM

run_as_chrome socat TCP-LISTEN:9222,fork,reuseaddr TCP:127.0.0.1:9223 &
forwarder_pid=$!
wait "$chrome_pid"
status=$?
kill "$forwarder_pid" 2>/dev/null || true
wait "$forwarder_pid" 2>/dev/null || true
exit "$status"
