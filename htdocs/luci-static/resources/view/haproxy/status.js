'use strict';
'require view';
'require fs';
'require uci';
'require poll';
'require ui';

function fmtUptime(s) {
    s = parseInt(s, 10) || 0;
    if (s <= 0)
        return '-';
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    var parts = [];
    if (d) parts.push(d + 'd');
    if (h) parts.push(h + 'h');
    parts.push(m + 'm');
    return parts.join(' ');
}

function readStatus() {
    return fs.exec('/usr/sbin/haproxy-status', []).then(function(res) {
        if (res.code !== 0) {
            console.error('haproxy-status exited ' + res.code + ': ' + (res.stderr || '(no stderr)'));
            return null;
        }
        var out = (res.stdout || '').trim();
        if (!out) {
            console.error('haproxy-status: empty output');
            return null;
        }
        try {
            return JSON.parse(out);
        } catch (e) {
            console.error('haproxy-status: JSON parse error: ' + e + ' — raw: ' + out);
            return null;
        }
    }).catch(function(err) {
        console.error('haproxy-status exec failed: ' + err);
        return null;
    });
}

// Resolve all rule sections to displayable rows — one per (subdomain x port),
// since ports come from the selected server's port list.
function ruleRows() {
    var rows = [];
    uci.sections('haproxy', 'rule').forEach(function(rule) {
        var srvId   = rule.server || '';
        var srvName = uci.get('haproxy', srvId, 'name') || srvId || '—';
        var srvHost = uci.get('haproxy', srvId, 'host') || '—';
        var ports   = L.toArray(uci.get('haproxy', srvId, 'ports'));
        var subs    = L.toArray(rule.subdomain);

        subs.forEach(function(subId) {
            var sub  = uci.get('haproxy', subId, 'name') || '';
            var domId = uci.get('haproxy', subId, 'domain') || '';
            var dom  = uci.get('haproxy', domId, 'name') || '';
            var fqdn = (sub && dom) ? sub + '.' + dom : '—';

            if (!ports.length) {
                rows.push([ fqdn, srvName, srvHost ]);
                return;
            }
            ports.forEach(function(port) {
                rows.push([ fqdn + ':' + port, srvName, srvHost + ':' + port ]);
            });
        });
    });
    return rows;
}

return view.extend({
    load: function() {
        return Promise.all([
            uci.load('haproxy'),
            readStatus()
        ]);
    },

    // Run an init action (start/restart/stop) and refresh the status box.
    // start/restart use a 2s delay before re-reading status because procd
    // returns immediately — haproxy needs time to actually bind and appear
    // in /proc before pgrep finds it.
    handleCtl: function(action, statusBox) {
        var self = this;
        var delay = (action === 'start' || action === 'restart') ? 2000 : 500;

        return fs.exec('/usr/sbin/haproxy-ctl', [action]).then(function(res) {
            if (res.code !== 0)
                ui.addNotification(null,
                    E('p', _('HAProxy %s failed: ').format(action) +
                        (res.stderr || res.stdout || _('unknown error'))), 'danger');
        }).catch(function(err) {
            ui.addNotification(null,
                E('p', _('Error running haproxy-ctl: ') + err.message), 'danger');
        }).then(function() {
            return new Promise(function(resolve) { window.setTimeout(resolve, delay); });
        }).then(function() {
            return readStatus();
        }).then(function(fresh) {
            statusBox.innerHTML = '';
            statusBox.appendChild(self.renderStatus(fresh));
        });
    },

    renderStatus: function(st) {
        var running = st && st.running;
        var badge = E('span', {
            'class': 'label ' + (running ? 'label-success' : 'label-danger'),
            'style': 'padding:.2em .6em;border-radius:3px;color:#fff;background:' +
                     (running ? '#5cb85c' : '#d9534f')
        }, running ? _('Running') : (st ? _('Stopped') : _('Unknown — check browser console')));

        var rows = [
            [ _('Service'), badge ],
            [ _('PID'), (st && st.pid) ? st.pid : '-' ],
            [ _('Uptime'), st ? fmtUptime(st.uptime) : '-' ],
            [ _('Listen ports'), (st && st.ports) ? st.ports : '-' ],
            [ _('Frontends'), st ? String(st.frontends) : '-' ],
            [ _('Backends'), st ? String(st.backends) : '-' ],
            [ _('Config file'),
              (st && st.cfg_present) ? '/etc/haproxy.cfg'
                                     : _('not generated yet') ]
        ];

        return E('table', { 'class': 'table' }, rows.map(function(r) {
            return E('tr', { 'class': 'tr' }, [
                E('td', { 'class': 'td left', 'width': '33%' }, E('strong', {}, r[0])),
                E('td', { 'class': 'td left' }, r[1])
            ]);
        }));
    },

    render: function(data) {
        var self = this;
        var st = data[1];

        var statusBox = E('div', {}, this.renderStatus(st));

        var controls = E('div', { 'class': 'cbi-page-actions', 'style': 'text-align:left;margin:0 0 1em 0' }, [
            E('button', {
                'class': 'btn cbi-button cbi-button-positive',
                'click': ui.createHandlerFn(self, 'handleCtl', 'start', statusBox)
            }, _('Start')),
            ' ',
            E('button', {
                'class': 'btn cbi-button cbi-button-action',
                'click': ui.createHandlerFn(self, 'handleCtl', 'restart', statusBox)
            }, _('Restart')),
            ' ',
            E('button', {
                'class': 'btn cbi-button cbi-button-negative',
                'click': ui.createHandlerFn(self, 'handleCtl', 'stop', statusBox)
            }, _('Stop'))
        ]);

        var rows = ruleRows();
        var rulesTable = E('table', { 'class': 'table cbi-section-table' }, [
            E('tr', { 'class': 'tr table-titles' }, [
                E('th', { 'class': 'th' }, _('SNI : Port')),
                E('th', { 'class': 'th' }, _('Backend Server')),
                E('th', { 'class': 'th' }, _('Target'))
            ])
        ].concat(rows.length ? rows.map(function(r) {
            return E('tr', { 'class': 'tr' }, [
                E('td', { 'class': 'td' }, r[0]),
                E('td', { 'class': 'td' }, r[1]),
                E('td', { 'class': 'td' }, r[2])
            ]);
        }) : [
            E('tr', { 'class': 'tr placeholder' }, [
                E('td', { 'class': 'td', 'colspan': '3' }, _('No rules configured.'))
            ])
        ]));

        // Refresh the runtime status every 5s without reloading the page.
        poll.add(function() {
            return readStatus().then(function(fresh) {
                statusBox.innerHTML = '';
                statusBox.appendChild(self.renderStatus(fresh));
            });
        }, 5);

        return E('div', {}, [
            E('h2', {}, _('HAProxy Status')),
            E('div', { 'class': 'cbi-section' }, [
                E('h3', {}, _('Service')),
                statusBox,
                controls
            ]),
            E('div', { 'class': 'cbi-section' }, [
                E('h3', {}, _('Active SNI Rules')),
                rulesTable
            ])
        ]);
    },

    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
