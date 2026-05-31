'use strict';
'require view';
'require form';
'require uci';

return view.extend({
    load: function() {
        return uci.load('haproxy');
    },

    render: function() {
        var m, s, o;

        m = new form.Map('haproxy', _('Subdomains'),
            _('Subdomains per domain. Combined with domain to form the SNI hostname.'));

        s = m.section(form.TableSection, 'subdomain', _('Subdomains'));
        s.addremove = true;
        s.anonymous = true;

        o = s.option(form.Value, 'name', _('Subdomain'));
        o.rmempty = false;

        o = s.option(form.ListValue, 'domain', _('Domain'));
        o.rmempty = false;
        uci.sections('haproxy', 'domain').forEach(function(domain) {
            o.value(domain['.name'], domain.name || domain['.name']);
        });

        o = s.option(form.DummyValue, '_fqdn', _('FQDN'));
        o.cfgvalue = function(section_id) {
            var sub  = uci.get('haproxy', section_id, 'name') || '';
            var did  = uci.get('haproxy', section_id, 'domain') || '';
            var dom  = uci.get('haproxy', did, 'name') || '';
            return (sub && dom) ? sub + '.' + dom : '—';
        };

        return m.render();
    }
});
