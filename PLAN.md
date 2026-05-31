# PLAN.md — luci-mod-haproxy

SNI passthrough HAProxy manager as an OpenWrt LuCI module.

---

## Stack Decisions

- **LuCI JS** (modern, not legacy Lua views) — views in `htdocs/luci-static/resources/view/haproxy/`
- **UCI** for config storage — section types: `server`, `domain`, `subdomain`, `rule`
- **Shell script** config generator — reads UCI, writes `/etc/haproxy/haproxy.cfg`
- **rpcd** for RPC calls from JS views to UCI + generator

---

## Phase 1 — Package Skeleton

- [x] `Makefile` — OpenWrt package definition (PKG_NAME, dependencies: haproxy, luci-base)
- [x] Directory structure scaffold
- [x] `root/etc/config/haproxy` — UCI config file with sane defaults
- [x] `root/usr/share/luci/menu.d/luci-mod-haproxy.json` — sidebar menu entry
- [x] `root/usr/share/rpcd/acl.d/luci-mod-haproxy.json` — ACL for rpcd access

---

## Phase 2 — UCI Data Model

Config file: `/etc/config/haproxy`

```
config server 'server1'
    option name    'proxmox'
    option host    '192.168.1.10'
    list   ports   '443'
    list   ports   '8006'

config domain 'domain1'
    option name    'example.com'

config subdomain 'sub1'
    option domain  'domain1'
    option name    'pve'

config rule 'rule1'
    option subdomain     'sub1'
    option frontend_port '443'
    option server        'server1'
    option backend_port  '8006'
```

- `server.ports` is a list (multiple ports one server can receive)
- `rule` is the join table: SNI match → backend target
- subdomain + domain together form the SNI hostname (`sub1.domain1` → `pve.example.com`)

---

## Phase 3 — Config Generator ✓

Script: `root/usr/sbin/haproxy-gen`

Logic:
1. Read all UCI sections
2. Build lookup maps: server id→host, subdomain id→fqdn, domain id→name
3. Group rules by `frontend_port`
4. For each frontend port emit:
   - `frontend ft_<port>` with `bind *:<port>`, `mode tcp`, inspect-delay, ssl_hello ACL
   - One `use_backend bk_<rule_id> if { req_ssl_sni -i <fqdn> }` per rule
5. For each rule emit `backend bk_<rule_id>` → `server s1 <host>:<backend_port>`
6. Validate with `haproxy -c -f` before replacing live config
7. Write to `/etc/haproxy/haproxy.cfg` then `service haproxy reload`

---

## Phase 4 — LuCI JS Views ✓

Four views under `htdocs/luci-static/resources/view/haproxy/`:

### `servers.js`
- Table: name, host, ports (comma-joined)
- Modal form: name (text), host (text), ports (dynamic list)
- UCI CRUD via `uci.sections('haproxy','server')`

### `domains.js`
- Table: name
- Modal form: name (text)
- UCI CRUD via `uci.sections('haproxy','domain')`

### `subdomains.js`
- Table: subdomain, domain (resolved name), full FQDN preview
- Modal form: subdomain (text), domain (select from UCI domains)
- UCI CRUD

### `rules.js`
- Table: FQDN:frontend_port → server name:backend_port
- Modal form:
  - subdomain (select, shows fqdn preview)
  - frontend_port (number)
  - server (select)
  - backend_port (select, filtered to server's declared ports)
- "Apply" button → calls rpcd to run `haproxy-gen`
- UCI CRUD + rpcd exec

---

## Phase 5 — Wiring ✓

- [ ] `root/etc/init.d/haproxy-gen` or UCI commit hook — auto-regenerate on `uci commit haproxy`
- [ ] rpcd call registration for `haproxy-gen` exec
- [ ] Validation in generator: warn on duplicate frontend_port+SNI combos
- [ ] `root/etc/uci-defaults/99-haproxy` — first-boot UCI defaults (global HAProxy settings)

---

## File Layout (target)

```
luci-mod-haproxy/
├── Makefile
├── htdocs/luci-static/resources/view/haproxy/
│   ├── servers.js
│   ├── domains.js
│   ├── subdomains.js
│   └── rules.js
├── root/
│   ├── etc/
│   │   ├── config/haproxy
│   │   ├── init.d/haproxy-gen
│   │   └── uci-defaults/99-haproxy
│   ├── usr/
│   │   ├── sbin/haproxy-gen
│   │   └── share/
│   │       ├── luci/menu.d/luci-mod-haproxy.json
│   │       └── rpcd/acl.d/luci-mod-haproxy.json
```

---

## Open Questions

- Global HAProxy settings (maxconn, log, stats socket) — separate UCI section `config globals` or hardcode in generator?
- Multi-port frontends: bind multiple ports on one frontend or one frontend per port?
- Error handling in generator: if haproxy config invalid, roll back or leave broken?
