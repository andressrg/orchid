import * as pulumi from "@pulumi/pulumi";
import * as hcloud from "@pulumi/hcloud";
import * as fs from "fs";
import * as path from "path";

const config = new pulumi.Config();
const stack = pulumi.getStack();

const serverType = config.get("serverType") || "cx22";
const location = config.get("location") || "nbg1";

// Read all .pub files from keys/ directory
const keysDir = path.join(__dirname, "keys");
const sshPubKeys: string[] = [];
if (fs.existsSync(keysDir)) {
  const keyFiles = fs.readdirSync(keysDir).filter((f) => f.endsWith(".pub"));
  for (const file of keyFiles) {
    sshPubKeys.push(fs.readFileSync(path.join(keysDir, file), "utf8").trim());
  }
}

// SSH keys (for initial access via Hetzner console if needed)
const sshKeys = sshPubKeys.map((publicKey, i) => {
  const name = `orchid-${stack}-${i}`;
  return new hcloud.SshKey(name, { name, publicKey });
});

// Cloud-init: minimal server setup — Kamal handles app deployment
const cloudInit = `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# System updates
apt-get update && apt-get -y upgrade

# Essentials
apt-get install -y curl git jq htop tmux fail2ban unattended-upgrades

# Docker (required by Kamal)
curl -fsSL https://get.docker.com | sh
systemctl enable docker

# Create deploy user
useradd -m -s /bin/bash deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
echo "deploy ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/deploy

# Disable root SSH login
sed -i 's/^#\\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd

# Auto security updates
dpkg-reconfigure -plow unattended-upgrades

echo "READY" > /home/deploy/READY
`;

// Server (IPv6-only — Cloudflare Tunnel provides access)
const server = new hcloud.Server(`orchid-${stack}`, {
  name: `orchid-${stack}`,
  serverType,
  location,
  image: "ubuntu-24.04",
  sshKeys: sshKeys.map((k) => k.id.apply((id) => id.toString())),
  userData: cloudInit,
  publicNets: [{
    ipv4Enabled: false,
    ipv6Enabled: true,
  }],
});

// Firewall — zero inbound ports, all traffic comes through Cloudflare Tunnel
const firewall = new hcloud.Firewall(`orchid-${stack}`, {
  name: `orchid-${stack}`,
  rules: [
    { direction: "in", protocol: "icmp", sourceIps: ["0.0.0.0/0", "::/0"], description: "Ping" },
  ],
});

new hcloud.FirewallAttachment(`orchid-${stack}`, {
  firewallId: firewall.id.apply((id) => parseInt(id)),
  serverIds: [server.id.apply((id) => parseInt(id))],
});

// Outputs
export const serverIpv6 = server.ipv6Address;
