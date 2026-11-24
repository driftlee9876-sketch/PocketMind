#!/usr/bin/env bash
set -euo pipefail
work=$(mktemp -d)
umask 077
keybase="/etc/wireguard/pm-ci-$$"
mkdir -p /etc/wireguard
trap 'ip netns del pm-host || true; ip netns del pm-donor || true; rm -f "$keybase-host.key" "$keybase-donor.key"; rm -rf "$work"' EXIT
for side in host donor; do
  if [[ $side == host ]]; then subnet=11; else subnet=22; fi
  ip netns add "pm-$side"
  ip link add "r-$side" type veth peer name "n-$side"
  ip link set "n-$side" netns "pm-$side"
  ip addr add "192.168.$subnet.1/24" dev "r-$side"
  ip link set "r-$side" up
  ip -n "pm-$side" link set lo up
  ip -n "pm-$side" addr add "192.168.$subnet.2/24" dev "n-$side"
  ip -n "pm-$side" link set "n-$side" up
  ip -n "pm-$side" route add default via "192.168.$subnet.1"
  ip -n "pm-$side" link add vpn0 type wireguard
  wg genkey > "$keybase-$side.key"
  wg pubkey < "$keybase-$side.key" > "$work/$side.pub"
done
sysctl -q -w net.ipv4.ip_forward=1
iptables -I FORWARD -i r-host -o r-donor -p udp --dport 51821 -j ACCEPT
iptables -I FORWARD -i r-donor -o r-host -p udp --dport 51821 -j ACCEPT
for side in host donor; do
  if [[ $side == host ]]; then self=100.74.4.9; remote=100.83.5.7; outside=192.168.22.2; other=donor
  else self=100.83.5.7; remote=100.74.4.9; outside=192.168.11.2; other=host; fi
  echo "Configuring the $side tunnel"
  ip netns exec "pm-$side" wg set vpn0 private-key "$keybase-$side.key" listen-port 51821 peer "$(cat "$work/$other.pub")" allowed-ips "$remote/32" endpoint "$outside:51821"
  ip -n "pm-$side" addr add "$self/32" dev vpn0
  ip -n "pm-$side" link set vpn0 up
  ip -n "pm-$side" route add "$remote/32" dev vpn0
done
ip netns exec pm-donor "$1" donor "$work" &
donor_pid=$!
ip netns exec pm-host "$1" host "$work"
wait "$donor_pid"
ip netns exec pm-host wg show vpn0 latest-handshakes | awk '$2 > 0 {ok=1} END {exit !ok}'
