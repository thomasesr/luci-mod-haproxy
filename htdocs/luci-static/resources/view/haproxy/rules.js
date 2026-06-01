'use strict';
'require view';
'require form';
'require uci';
'require fs';
'require ui';

return view.extend({
    load: function() {
        return uci.load('haproxy');
    },

    handleApply: function() {
        // Commit pending form edits to UCI before regenerating, otherwise
        // haproxy-gen reads stale committed config and ignores unsaved rules.
        return this.map.save(null, true).then(function() {
            return uci.save();
        }).then(function() {
            return uci.apply();
        }).then(function() {
            return fs.exec('/usr/sbin/haproxy-gen', []);
        }).then(function(res) {
            if (res.code === 0) {
                ui.addNotification(null,
                    E('p', _('HAProxy configuration applied successfully.')), 'info');
            } else {
                ui.addNotification(null,
                    E('p', _('Failed to apply: ') + (res.stderr || _('unknown error'))), 'danger');
            }
        }).catch(function(err) {
            ui.addNotification(null,
                E('p', _('Error running haproxy-gen: ') + err.message), 'danger');
        });
    },

    render: function() {
        var m, s, o;
        var self = this;

        m = new form.Map('haproxy', _('SNI Rules'),
            _('Route one or more subdomains to a backend server via TCP SNI passthrough. ' +
              'The listen and backend ports are taken automatically from the ' +
              'selected server\'s port list — no port is configured here.'));
        self.map = m;

        s = m.section(form.TableSection, 'rule', _('Rules'));
        s.addremove = true;
        s.anonymous = true;

        o = s.option(form.ListValue, 'server', _('Backend Server'));
        o.rmempty = false;
        uci.sections('haproxy', 'server').forEach(function(srv) {
            var ports = L.toArray(srv.ports);
            var label = (srv.name || srv['.name']) +
                        (ports.length ? ' (' + ports.join(', ') + ')' : '');
            o.value(srv['.name'], label);
        });

        o = s.option(form.MultiValue, 'subdomain', _('Subdomains'));
        o.rmempty = false;
        o.display_size = 8;
        uci.sections('haproxy', 'subdomain').forEach(function(sub) {
            var did    = sub.domain || '';
            var dom    = uci.get('haproxy', did, 'name') || '';
            var label  = (sub.name && dom) ? sub.name + '.' + dom : sub['.name'];
            o.value(sub['.name'], label);
        });

        o = s.option(form.DummyValue, '_ports', _('Ports'));
        o.cfgvalue = function(section_id) {
            var srvId = uci.get('haproxy', section_id, 'server') || '';
            var ports = L.toArray(uci.get('haproxy', srvId, 'ports'));
            return ports.length ? ports.join(', ') : '—';
        };

        return m.render().then(function(node) {
            node.appendChild(
                E('div', { 'class': 'cbi-page-actions' }, [
                    E('button', {
                        'class': 'btn cbi-button cbi-button-apply',
                        'click': ui.createHandlerFn(self, 'handleApply')
                    }, _('Apply Configuration'))
                ])
            );
            return node;
        });
    }
});
