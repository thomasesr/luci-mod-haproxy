# luci-mod-haproxy

A LuCI module for OpenWrt that manages HAProxy as an **SNI passthrough** proxy.
HAProxy runs in TCP mode — it never terminates TLS. Instead it peeks at the
unencrypted SNI field in the TLS ClientHello and forwards the raw TCP stream to
the matching backend server.

Because TLS is never terminated, certificates and private keys stay on the
backend servers. The router is a dumb SNI switch: one public IP, many internal
HTTPS services, each reached by hostname.

```
Browser → router:443 → (SNI: pve.example.com) → 192.168.1.10:443
Browser → router:443 → (SNI: mail.example.com) → 192.168.1.20:443
```

---

## Features

- **Web UI** under **Services → HAProxy** (modern LuCI JS — no Lua)
- **Status tab** — live service state, PID, uptime, listening ports, active
  rule table; auto-refreshes every 5 s; Start / Restart / Stop buttons
- **Port 80 → HTTPS redirect** — always generated automatically, no config
  needed; plain HTTP can never carry SNI so this is the correct behaviour
- **Ports from server** — add ports once on the Server; rules pick them up
  automatically; no per-rule port field
- **Multi-subdomain rules** — one rule maps multiple subdomains to one server
- **Exclusive subdomain assignment** — a subdomain already used in a rule is
  hidden from other rules' selection lists
- **Safe config replace** — new config is built and validated with
  `haproxy -c -f` in RAM (`/tmp`) before a single flash byte is written;
  bad config aborts and the live config is never touched
- **Port conflict detection** — refuses to reload if a non-haproxy process
  already holds a listen port
- **Auto-start at boot** — `uci-defaults` enables and starts both
  `haproxy-gen` (START=96) and `haproxy` (START=99) on first install
- **Auto-regenerate on UCI commit** — procd `service_triggers` re-runs the
  generator whenever `uci commit haproxy` is called

---

## How it works

### Domain model

Everything is stored in `/etc/config/haproxy` using four UCI section types:

| Section | Fields | Purpose |
|---------|--------|---------|
| `globals` | `maxconn`, `log`, `stats_socket`, `inspect_delay` | HAProxy global tunables |
| `server` | `name`, `host`, `ports` (list) | A backend LAN server |
| `domain` | `name` | A base domain, e.g. `example.com` |
| `subdomain` | `name`, `domain` | A label under a domain, e.g. `pve` |
| `rule` | `server`, `subdomain` (list) | Routes subdomains → server |

A rule has **no port field**. The listen and backend ports both come from the
server's `ports` list. Each (subdomain × port) combination produces one
`frontend` ACL entry and one `backend` block.

### FQDN resolution

```
subdomain.name + domain.name = FQDN used as SNI match

  sub1 → "pve"  +  domain1 → "example.com"  =  pve.example.com
```

### Generated haproxy.cfg

Given server `192.168.1.10` with ports `443` `8006` and subdomains
`pve.example.com` + `mail.example.com`:

```
frontend ft_80
    bind *:80
    mode http
    http-request redirect scheme https code 301   ← always present

frontend ft_443
    bind *:443
    mode tcp
    tcp-request inspect-delay 5s
    tcp-request content accept if { req_ssl_hello_type 1 }
    acl sni_pve_example_com  req_ssl_sni -i pve.example.com
    acl sni_mail_example_com req_ssl_sni -i mail.example.com
    use_backend bk_server1_443 if sni_pve_example_com
    use_backend bk_server1_443 if sni_mail_example_com

frontend ft_8006
    bind *:8006
    mode tcp
    ...same ACLs...
    use_backend bk_server1_8006 if sni_pve_example_com
    use_backend bk_server1_8006 if sni_mail_example_com

backend bk_server1_443
    mode tcp
    server s1 192.168.1.10:443

backend bk_server1_8006
    mode tcp
    server s1 192.168.1.10:8006
```

### Config generation pipeline

`/usr/sbin/haproxy-gen` follows this sequence on every run:

1. **Build** — write `global` + `defaults` + port-80 redirect frontend + all
   SNI frontends and backends into a staging file in `/tmp` (RAM — no flash
   write yet)
2. **Validate** — `haproxy -c -f /tmp/haproxy-gen.$$.cfg`; capture and report
   full validator output on failure; abort leaving live config untouched
3. **Port check** — scan listen ports via `/proc`; abort if a non-haproxy
   process holds one (prevents silent bind failure on reload)
4. **Atomic install** — `cp` staging file to `/etc/haproxy.cfg.tmp` (same
   filesystem as target); `mv /etc/haproxy.cfg.tmp /etc/haproxy.cfg`
   (same-fs rename, atomic); ensures `/var/run/haproxy/` exists for the
   stats socket
5. **Reload** — `service haproxy reload`

Triggered three ways:
- **Apply Configuration** button in the SNI Rules view (saves UCI first)
- `service haproxy-gen reload` from CLI
- Automatically via procd on every `uci commit haproxy`

---

## UI tabs

### Status

Live read-only dashboard. Polls `/usr/sbin/haproxy-status` every 5 s (reads
`/proc` — no external dependencies, works in rpcd's restricted exec
environment).

| Field | Description |
|-------|-------------|
| Service | Running / Stopped badge |
| PID | Master process PID |
| Uptime | Derived from `/proc/uptime` and `/proc/<pid>/stat` |
| Listen ports | Parsed from `/etc/haproxy.cfg` |
| Frontends / Backends | Count from `/etc/haproxy.cfg` |
| Config file | Present / not generated yet |

Buttons: **Start**, **Restart**, **Stop** — invoke `/usr/sbin/haproxy-ctl`
(allow-listed wrapper around `/etc/init.d/haproxy`) and refresh the status
box after a short delay.

The active SNI rules table shows each (FQDN:port → backend) mapping. Port 80
entries show as `→ https://fqdn/` redirect.

### Servers

Manage backend LAN servers. Each server has a name, a host/IP, and a list of
ports. The ports drive the generated frontends and backends — no ports entered
anywhere else.

### Domains

Manage base domains (e.g. `example.com`). One field: the domain name
(validated as hostname).

### Subdomains

Manage subdomains linked to a domain. Shows a live FQDN preview
(`subdomain.domain`).

### SNI Rules

Map one backend server to one or more subdomains. Ports are shown (read-only)
from the selected server's port list. Subdomains already assigned to another
rule are hidden from the selection list. Saving commits pending UCI changes
before invoking `haproxy-gen`.

---

## Installation

### From a GitHub Release (recommended)

```sh
# On the router:
opkg update && opkg install haproxy   # or: apk add haproxy
scp luci-mod-haproxy-0.9.0-r1.apk root@router:/tmp/
apk add --allow-untrusted /tmp/luci-mod-haproxy-0.9.0-r1.apk
```

The package is `arch=all` — the same `.apk` installs on any architecture
(x86_64, mipsel_24kc/MT7621, aarch64, …).

### From source (OpenWrt SDK)

```sh
# Prerequisites
sudo apt-get install -y gawk rsync file libncurses-dev zstd build-essential git

# Download and extract SDK (adjust version/target as needed)
SDK=openwrt-sdk-25.12.4-x86-64_gcc-14.3.0_musl.Linux-x86_64
curl -O https://downloads.openwrt.org/releases/25.12.4/targets/x86/64/$SDK.tar.zst
tar --zstd -xf $SDK.tar.zst && mv $SDK sdk && cd sdk

# Feeds
cp feeds.conf.default feeds.conf
./scripts/feeds update -a
./scripts/feeds install -a -p luci
./scripts/feeds install haproxy

# Link and build
ln -sfn /path/to/luci-mod-haproxy package/luci-mod-haproxy
echo "CONFIG_PACKAGE_luci-mod-haproxy=m" >> .config && make defconfig
make package/luci-mod-haproxy/compile V=s
# APK: bin/packages/x86_64/base/luci-mod-haproxy-*.apk
```

---

## Post-install on router

The `uci-defaults` script runs once and:
- Creates the `globals` UCI section if absent
- Enables and starts `haproxy-gen` (START=96) and `haproxy` (START=99)
- Generates the initial config and starts haproxy immediately

If you installed before these fixes were in place:
```sh
/etc/init.d/haproxy-gen enable
/etc/init.d/haproxy enable
/usr/sbin/haproxy-gen
/etc/init.d/haproxy start
```

After install, clear LuCI's menu cache if tabs don't appear:
```sh
rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/*
/etc/init.d/rpcd restart
```

---

## Firewall

HAProxy listens on the OpenWrt router. For WAN traffic to reach it, add
firewall rules forwarding the relevant ports (typically 443, 8006, …) from
the WAN zone to the router itself. With nftables (OpenWrt 22+):

```sh
# Accept inbound 443 on WAN (adjust interface name as needed)
uci add firewall rule
uci set firewall.@rule[-1].name='Allow-HTTPS-HAProxy'
uci set firewall.@rule[-1].src='wan'
uci set firewall.@rule[-1].dest_port='443'
uci set firewall.@rule[-1].proto='tcp'
uci set firewall.@rule[-1].target='ACCEPT'
uci commit firewall && /etc/init.d/firewall restart
```

> **Note:** if LuCI's `uhttpd` also listens on 443/80, move it to different
> ports first — both cannot bind the same port.

---

## Example UCI config

```
config globals 'globals'
    option maxconn       '4096'
    option log           'stdout local0'
    option stats_socket  '/var/run/haproxy/haproxy.sock'
    option inspect_delay '5s'

config server 'srv_proxmox'
    option name  'Proxmox'
    option host  '192.168.1.10'
    list   ports '443'
    list   ports '8006'

config server 'srv_mail'
    option name  'Mailserver'
    option host  '192.168.1.20'
    list   ports '443'

config domain 'dom1'
    option name 'example.com'

config subdomain 'sub_pve'
    option domain 'dom1'
    option name   'pve'

config subdomain 'sub_mail'
    option domain 'dom1'
    option name   'mail'

config rule 'rule1'
    option server    'srv_proxmox'
    list   subdomain 'sub_pve'

config rule 'rule2'
    option server    'srv_mail'
    list   subdomain 'sub_mail'
```

Result:
- `pve.example.com:443` → `192.168.1.10:443`
- `pve.example.com:8006` → `192.168.1.10:8006`
- `mail.example.com:443` → `192.168.1.20:443`
- `*:80` → 301 redirect to `https://`

---

## Repository layout

| Path | Purpose |
|------|---------|
| `Makefile` | OpenWrt package definition |
| `.github/workflows/release.yml` | CI: builds APK on `v*` tag push |
| `root/etc/config/haproxy` | Default UCI globals |
| `root/usr/sbin/haproxy-gen` | Config generator (build → validate → port-check → atomic install) |
| `root/usr/sbin/haproxy-status` | JSON status emitter (uses `/proc` scan, no external deps) |
| `root/usr/sbin/haproxy-ctl` | Allow-listed init wrapper (start/stop/restart/reload/status) |
| `root/etc/init.d/haproxy-gen` | procd init START=96, UCI reload trigger |
| `root/etc/uci-defaults/99-haproxy` | First-boot setup: enable services, generate config, start haproxy |
| `root/usr/share/luci/menu.d/` | Sidebar navigation (ACL-gated) |
| `root/usr/share/rpcd/acl.d/` | rpcd ACLs (read: status; write: gen + ctl) |
| `htdocs/.../view/haproxy/status.js` | Status tab (poll + Start/Restart/Stop) |
| `htdocs/.../view/haproxy/servers.js` | Servers CRUD |
| `htdocs/.../view/haproxy/domains.js` | Domains CRUD |
| `htdocs/.../view/haproxy/subdomains.js` | Subdomains CRUD + FQDN preview |
| `htdocs/.../view/haproxy/rules.js` | SNI Rules CRUD + exclusive subdomain filter + Apply |

---

## Compatibility

| OpenWrt version | Package format | Status |
|-----------------|---------------|--------|
| 25.12.4 | APK | Tested |
| 24.10.x | IPK | Should work (untested) |

Tested devices: x86_64 VM, MikroTik RouterBOARD 750Gr3 (MT7621).

---

## License

GPL-2.0. See [LICENSE](LICENSE).
