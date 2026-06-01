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
            _('Map each subdomain.domain:port to a backend server via TCP SNI passthrough. ' +
              'The backend is reached on the same port the rule listens on.'));
        self.map = m;

        s = m.section(form.TableSection, 'rule', _('Rules'));
        s.addremove = true;
        s.anonymous = true;

        o = s.option(form.ListValue, 'subdomain', _('Subdomain'));
        o.rmempty = false;
        uci.sections('haproxy', 'subdomain').forEach(function(sub) {
            var did    = sub.domain || '';
            var dom    = uci.get('haproxy', did, 'name') || '';
            var label  = (sub.name && dom) ? sub.name + '.' + dom : sub['.name'];
            o.value(sub['.name'], label);
        });

        o = s.option(form.Value, 'frontend_port', _('Listen Port'));
        o.datatype = 'port';
        o.rmempty = false;

        o = s.option(form.ListValue, 'server', _('Backend Server'));
        o.rmempty = false;
        uci.sections('haproxy', 'server').forEach(function(srv) {
            o.value(srv['.name'], srv.name || srv['.name']);
        });

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
