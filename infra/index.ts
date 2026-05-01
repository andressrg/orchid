import * as pulumi from '@pulumi/pulumi';
import * as digitalocean from '@pulumi/digitalocean';
import * as fs from 'fs';
import * as path from 'path';

// Read all .pub files from keys/ directory
// To add a teammate: drop their id_ed25519.pub into keys/<name>.pub and run pulumi up
const keysDir = path.join(__dirname, 'keys');
const keyFiles = fs.readdirSync(keysDir).filter((f) => f.endsWith('.pub'));

const sshKeys = keyFiles.map((file) => {
  const name = path.basename(file, '.pub');
  const publicKey = fs.readFileSync(path.join(keysDir, file), 'utf8').trim();
  return new digitalocean.SshKey(`orchid-${name}`, {
    name: `orchid-${name}`,
    publicKey,
  });
});

// Cloud-init shared across both droplets
const userData = `#!/bin/bash
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
export HOME=/root

# System updates
apt-get update && apt-get -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" upgrade

# Essentials
apt-get install -y curl git build-essential unzip jq htop tmux

# Node.js 22 via fnm
curl -fsSL https://fnm.vercel.app/install | bash
export PATH="/root/.local/share/fnm:$PATH"
eval "$(fnm env --shell bash)"
fnm install 22
fnm default 22

# PATH setup for login shells
cat >> /root/.profile << 'PROFILE'
export PATH="/root/.local/share/fnm:/root/.local/bin:$PATH"
eval "$(fnm env --shell bash)"
PROFILE
cat >> /root/.bashrc << 'BASHRC'
export PATH="/root/.local/share/fnm:/root/.local/bin:$PATH"
eval "$(fnm env --shell bash)"
BASHRC

# pnpm
npm install -g pnpm

# uv (Python)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker

# GitHub CLI
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli-stable.list > /dev/null
apt-get update && apt-get install -y gh

# Claude Code
npm install -g @anthropic-ai/claude-code

# OpenAI Codex CLI
npm install -g @openai/codex

# Caddy (reverse proxy for web apps)
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy

echo "READY" > /root/READY
`;

const inboundRules: digitalocean.types.input.FirewallInboundRule[] = [
  { protocol: 'tcp', portRange: '22', sourceAddresses: ['0.0.0.0/0', '::/0'] },
  { protocol: 'tcp', portRange: '80', sourceAddresses: ['0.0.0.0/0', '::/0'] },
  { protocol: 'tcp', portRange: '443', sourceAddresses: ['0.0.0.0/0', '::/0'] },
  {
    protocol: 'tcp',
    portRange: '3000',
    sourceAddresses: ['0.0.0.0/0', '::/0'],
  },
  { protocol: 'icmp', sourceAddresses: ['0.0.0.0/0', '::/0'] },
];

const outboundRules: digitalocean.types.input.FirewallOutboundRule[] = [
  {
    protocol: 'tcp',
    portRange: '1-65535',
    destinationAddresses: ['0.0.0.0/0', '::/0'],
  },
  {
    protocol: 'udp',
    portRange: '1-65535',
    destinationAddresses: ['0.0.0.0/0', '::/0'],
  },
  { protocol: 'icmp', destinationAddresses: ['0.0.0.0/0', '::/0'] },
];

// --- DEPLOY DROPLET (hosts the web app, exposed to internet) ---
const deployDroplet = new digitalocean.Droplet('orchid-deploy', {
  name: 'orchid-deploy',
  image: 'ubuntu-24-04-x64',
  region: digitalocean.Region.NYC1,
  size: 's-4vcpu-8gb', // $48/mo — 4 vCPU, 8GB RAM, 160GB SSD
  sshKeys: sshKeys.map((k) => k.fingerprint),
  userData: userData,
  monitoring: true,
  backups: false,
});

const deployFirewall = new digitalocean.Firewall('orchid-deploy', {
  name: 'orchid-deploy',
  dropletIds: [deployDroplet.id.apply((id) => parseInt(id))],
  inboundRules,
  outboundRules,
});

// Outputs
export const deployIp = deployDroplet.ipv4Address;
export const sshDeploy = pulumi.interpolate`ssh -i ~/.ssh/orchid-agent root@${deployDroplet.ipv4Address}`;
