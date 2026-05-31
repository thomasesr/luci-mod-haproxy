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

        m = new form.Map('haproxy', _('Domains'),
            _('Base domains used in SNI passthrough rules.'));

        s = m.section(form.TableSection, 'domain', _('Domains'));
        s.addremove = true;
        s.anonymous = true;

        o = s.option(form.Value, 'name', _('Domain'));
        o.datatype = 'hostname';
        o.rmempty = false;

        return m.render();
    }
});
