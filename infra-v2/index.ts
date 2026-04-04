import * as pulumi from "@pulumi/pulumi";
import * as hcloud from "@pulumi/hcloud";
import * as fs from "fs";
import * as path from "path";

const config = new pulumi.Config();
const stack = pulumi.getStack();

const serverType = config.get("serverType") || "cx22";
const location = config.get("location") || "nbg1";
const dbPassword = config.requireSecret("dbPassword");
const apiKey = config.requireSecret("apiKey");

// Read all .pub files from keys/ directory
const keysDir = path.join(__dirname, "keys");
const sshPubKeys: string[] = [];
if (fs.existsSync(keysDir)) {
  const keyFiles = fs.readdirSync(keysDir).filter((f) => f.endsWith(".pub"));
  for (const file of keyFiles) {
    sshPubKeys.push(fs.readFileSync(path.join(keysDir, file), "utf8").trim());
  }
}

// SSH keys
const sshKeys = sshPubKeys.map((publicKey, i) => {
  const name = `orchid-${stack}-${i}`;
  return new hcloud.SshKey(name, { name, publicKey });
});

// Cloud-init: install Node.js, pnpm, PostgreSQL, Caddy, pm2
const cloudInit = pulumi.interpolate`#!/bin/bash
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
export HOME=/root

# System updates
apt-get update && apt-get -y upgrade

# Essentials
apt-get install -y curl git build-essential unzip jq htop tmux

# Node.js 22 via fnm
curl -fsSL https://fnm.vercel.app/install | bash
export PATH="/root/.local/share/fnm:$PATH"
eval "$(fnm env --shell bash)"
fnm install 22
fnm default 22

cat >> /root/.bashrc << 'BASHRC'
export PATH="/root/.local/share/fnm:/root/.local/bin:$PATH"
eval "$(fnm env --shell bash)"
BASHRC

# pnpm + pm2
npm install -g pnpm pm2

# PostgreSQL 16
apt-get install -y postgresql-16 postgresql-client-16
systemctl enable postgresql
systemctl start postgresql

sudo -u postgres psql -c "CREATE USER orchid WITH PASSWORD '${dbPassword}';"
sudo -u postgres psql -c "CREATE DATABASE orchid OWNER orchid;"

# Caddy (reverse proxy + automatic TLS)
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy

# Create app directory and env file
mkdir -p /opt/orchid-server
cat > /opt/orchid-server/.env << ENV
PORT=3000
DATABASE_URL=postgresql://orchid:${dbPassword}@localhost:5432/orchid
API_KEY=${apiKey}
ENV

echo "READY" > /root/READY
`;

// Server (IPv6-only — Cloudflare proxy provides IPv4 access)
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

// Firewall
const firewall = new hcloud.Firewall(`orchid-${stack}`, {
  name: `orchid-${stack}`,
  rules: [
    { direction: "in", protocol: "tcp", port: "22", sourceIps: ["0.0.0.0/0", "::/0"], description: "SSH" },
    { direction: "in", protocol: "tcp", port: "80", sourceIps: ["0.0.0.0/0", "::/0"], description: "HTTP" },
    { direction: "in", protocol: "tcp", port: "443", sourceIps: ["0.0.0.0/0", "::/0"], description: "HTTPS" },
    { direction: "in", protocol: "tcp", port: "3000", sourceIps: ["0.0.0.0/0", "::/0"], description: "API" },
    { direction: "in", protocol: "icmp", sourceIps: ["0.0.0.0/0", "::/0"], description: "Ping" },
  ],
});

new hcloud.FirewallAttachment(`orchid-${stack}`, {
  firewallId: firewall.id.apply((id) => parseInt(id)),
  serverIds: [server.id.apply((id) => parseInt(id))],
});

// Outputs
export const serverIpv6 = server.ipv6Address;
export const ssh = pulumi.interpolate`ssh root@${server.ipv6Address}`;
