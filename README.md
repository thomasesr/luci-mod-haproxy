# luci-mod-haproxy

A LuCI module for OpenWrt that manages HAProxy as an **SNI passthrough** proxy:
HAProxy runs in TCP mode (no TLS termination) and routes inbound HTTPS traffic
to LAN servers based on the SNI hostname in the TLS handshake.

Because TLS is never terminated, certificates and private keys stay on the
backend servers. The router only inspects the unencrypted SNI field to decide
where each connection goes.

## Features

- Web UI under **Services → HAProxy** (modern LuCI JS, no Lua views)
- CRUD for backend servers, domains, subdomains, and routing rules
- Generates `/etc/haproxy/haproxy.cfg` from UCI config
- Validates with `haproxy -c` before replacing the live config — bad input
  never takes down the running proxy
- Auto-regenerates on every `uci commit haproxy` (procd trigger)

## How it works

The module stores everything in the UCI config `/etc/config/haproxy` using four
section types:

| Section | Purpose |
|---------|---------|
| `server` | Backend LAN server: `name`, `host` (IP/hostname), `ports` |
| `domain` | Base domain, e.g. `example.com` |
| `subdomain` | A label under a domain, e.g. `pve`, linked to a `domain` |
| `rule` | Join record: `subdomain` + `frontend_port` → `server` |

A rule resolves transitively to an SNI match:

```
subdomain (pve) + domain (example.com) = pve.example.com
```

So a rule with `frontend_port 443` pointing at server `192.168.1.10` produces:

```
pve.example.com:443  →  192.168.1.10:443
```

The backend is always reached on the **same port** the rule listens on — SNI
passthrough forwards the connection unchanged.

### Config generation

`/usr/sbin/haproxy-gen` reads the UCI config and writes `/etc/haproxy/haproxy.cfg`:

1. Resolves every `rule` to `frontend_port fqdn server_host` (backend port = listen port)
2. Groups rules by `frontend_port` — one `frontend ft_<port>` per unique port
3. Each frontend: `mode tcp`, `tcp-request inspect-delay`, an SNI ACL
   (`req_ssl_sni`) and a `use_backend` per rule
4. Each rule gets a `backend bk_<id>` with a single `server` line
5. Warns on duplicate `port + SNI` combinations
6. Validates with `haproxy -c -f` **before** atomically replacing the live
   config; on success runs `service haproxy reload`

It runs three ways:

- The **Apply Configuration** button in the SNI Rules view
- `service haproxy-gen reload` from the CLI
- Automatically via procd whenever `uci commit haproxy` runs

## Usage

1. **Servers** — add each backend LAN server (name, host/IP, ports it serves)
2. **Domains** — add your base domains (e.g. `example.com`)
3. **Subdomains** — add subdomains and link each to a domain; the view shows the
   resulting FQDN
4. **SNI Rules** — map `subdomain.domain:listen_port` to a backend `server`,
   then click **Apply Configuration**. The backend is reached on the same port.
5. **Status** — read-only tab showing whether HAProxy is running, its PID,
   uptime, listening ports, and the active SNI rules (auto-refreshes every 5s)

Make sure your firewall forwards the relevant inbound ports (typically 443) to
the OpenWrt router.

## Example UCI config

```
config globals 'globals'
    option maxconn       '4096'
    option log           'stdout local0'
    option stats_socket  '/var/run/haproxy/haproxy.sock'
    option inspect_delay '5s'

config server 'server1'
    option name  'proxmox'
    option host  '192.168.1.10'
    list   ports '443'
    list   ports '8006'

config domain 'domain1'
    option name 'example.com'

config subdomain 'sub1'
    option domain 'domain1'
    option name   'pve'

config rule 'rule1'
    option subdomain     'sub1'
    option frontend_port '443'
    option server        'server1'
```

## Building

Standard OpenWrt LuCI package. Place in the LuCI feed and build:

```sh
make package/luci-mod-haproxy/compile
```

Dependencies: `haproxy`, `luci-base`.

## Layout

| Path | Purpose |
|------|---------|
| `Makefile` | OpenWrt package definition |
| `root/etc/config/haproxy` | UCI config with globals defaults |
| `root/usr/sbin/haproxy-gen` | Config generator |
| `root/usr/sbin/haproxy-status` | Read-only JSON status emitter for the Status view |
| `root/etc/init.d/haproxy-gen` | procd init + UCI reload trigger |
| `root/etc/uci-defaults/99-haproxy` | First-boot setup |
| `root/usr/share/luci/menu.d/` | Sidebar navigation |
| `root/usr/share/rpcd/acl.d/` | rpcd ACLs |
| `htdocs/luci-static/resources/view/haproxy/` | LuCI JS views |

## License

GPL-2.0. See [LICENSE](LICENSE).
