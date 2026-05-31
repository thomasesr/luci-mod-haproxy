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

        m = new form.Map('haproxy', _('Servers'),
            _('Backend LAN servers HAProxy can route traffic to.'));

        s = m.section(form.TableSection, 'server', _('Servers'));
        s.addremove = true;
        s.anonymous = true;

        o = s.option(form.Value, 'name', _('Name'));
        o.rmempty = false;

        o = s.option(form.Value, 'host', _('Host / IP'));
        o.datatype = 'or(hostname, ipaddr)';
        o.rmempty = false;

        o = s.option(form.DynamicList, 'ports', _('Ports'));
        o.datatype = 'port';
        o.rmempty = false;

        return m.render();
    }
});
