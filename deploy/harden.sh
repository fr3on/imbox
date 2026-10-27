#!/usr/bin/env bash
# Locks down a server set up by setup.sh: key-only ssh, brute-force banning, automatic security updates, swap, no stray network services.
# Safe to re-run. Run as root, from a session you will keep open; test a second ssh login before closing it.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get install -y fail2ban unattended-upgrades >/dev/null

# ssh: keys only. Root may log in with a key (deploys use it) but never a password.
cat > /etc/ssh/sshd_config.d/00-imbox-hardening.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 20
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
CONF
sshd -t
systemctl reload ssh || systemctl reload sshd

# fail2ban: ban an address for an hour after 4 failed ssh logins in 10 minutes
cat > /etc/fail2ban/jail.d/imbox.local <<'CONF'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 4
[sshd]
enabled = true
backend = systemd
CONF
systemctl enable --now fail2ban >/dev/null
systemctl restart fail2ban

# Automatic security updates
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF

# Swap, so a memory spike slows things down instead of killing a process
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness = 10' > /etc/sysctl.d/90-imbox.conf
sysctl -q -p /etc/sysctl.d/90-imbox.conf

# No LLMNR/mDNS listening on the network
install -d /etc/systemd/resolved.conf.d
printf '[Resolve]\nLLMNR=no\nMulticastDNS=no\n' > /etc/systemd/resolved.conf.d/imbox.conf
systemctl restart systemd-resolved || true

echo "Hardened."
