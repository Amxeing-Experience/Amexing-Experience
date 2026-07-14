/**
 * Advance Time Picker — util del cliente
 *
 * Controla el molecule `advance-time-picker.ejs`: presets (1h/24h/48h/72h) +
 * "Personalizado" (Días/Horas/Minutos). Sincroniza SIEMPRE el total en MINUTOS
 * hacia el <input hidden .atp-hidden> del contenedor, para que el guardado
 * existente (que lee ese input) no cambie.
 *
 * API pública:
 *   window.AdvanceTimePicker.set(container, minutes)
 *     Ajusta el picker a un valor en minutos (usado al editar). Elige preset si
 *     coincide, si no activa "Personalizado" y descompone en días/horas/min.
 *
 * Usa delegación de eventos, así que funciona con tarjetas agregadas
 * dinámicamente (clonadas por JS).
 *
 * @author Denisse Maldonado
 */
(function () {
    'use strict';

    if (window.AdvanceTimePicker) { return; } // singleton

    var DAY = 1440;
    var HOUR = 60;

    // Estilo olivo de marca, inyectado una sola vez (el molecule puede incluirse varias veces).
    function injectStyles() {
        if (document.getElementById('atp-styles')) { return; }
        var css =
            '.advance-time-picker .atp-preset,' +
            '.advance-time-picker .atp-custom-toggle{' +
                'border:1px solid #6E7A50;background:#fff;color:#566040;' +
                'font-weight:500;transition:background .15s ease,color .15s ease;}' +
            '.advance-time-picker .atp-preset:hover,' +
            '.advance-time-picker .atp-custom-toggle:hover{background:#eef0e6;color:#3f4730;}' +
            '.advance-time-picker .atp-preset.active,' +
            '.advance-time-picker .atp-custom-toggle.active{' +
                'background:#6E7A50;border-color:#6E7A50;color:#fff;}' +
            '.advance-time-picker .atp-preset.active:hover,' +
            '.advance-time-picker .atp-custom-toggle.active:hover{background:#566040;color:#fff;}' +
            '.advance-time-picker .atp-custom .form-control:focus{' +
                'border-color:#6E7A50;box-shadow:0 0 0 .2rem rgba(110,122,80,.2);}';
        var style = document.createElement('style');
        style.id = 'atp-styles';
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectStyles);
    } else {
        injectStyles();
    }

    function hiddenOf(container) { return container.querySelector('.atp-hidden'); }
    function customOf(container) { return container.querySelector('.atp-custom'); }
    function presetsOf(container) {
        return Array.prototype.slice.call(container.querySelectorAll('.atp-preset'));
    }

    function readCustom(container) {
        var daysEl = container.querySelector('.atp-days'); // opcional (showDays:false)
        var d = daysEl ? (parseInt(daysEl.value, 10) || 0) : 0;
        var h = parseInt(container.querySelector('.atp-hours').value, 10) || 0;
        var m = parseInt(container.querySelector('.atp-mins').value, 10) || 0;
        return (d * DAY) + (h * HOUR) + m;
    }

    // El picker trabaja internamente en MINUTOS; el hidden puede guardarse en
    // minutos (default) o en horas decimales (data-atp-unit="hours").
    function unitOf(container) {
        return container.getAttribute('data-atp-unit') || 'minutes';
    }
    function toHidden(minutes, unit) {
        if (unit === 'hours') { return Math.round((minutes / HOUR) * 100) / 100; }
        return minutes;
    }
    function fromHidden(value, unit) {
        if (unit === 'hours') { return Math.round(value * HOUR); }
        return Math.round(value);
    }

    function writeHidden(container, minutes) {
        var hidden = hiddenOf(container);
        if (!hidden) { return; }
        hidden.value = (minutes && minutes > 0) ? toHidden(minutes, unitOf(container)) : '';
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function clearActive(container) {
        presetsOf(container).forEach(function (b) { b.classList.remove('active'); });
        var toggle = container.querySelector('.atp-custom-toggle');
        if (toggle) { toggle.classList.remove('active'); }
    }

    function showCustom(container, show) {
        var c = customOf(container);
        if (c) { c.style.display = show ? '' : 'none'; }
    }

    function activatePreset(container, btn) {
        clearActive(container);
        btn.classList.add('active');
        showCustom(container, false);
        writeHidden(container, parseInt(btn.dataset.minutes, 10) || 0);
    }

    function activateCustom(container) {
        clearActive(container);
        var toggle = container.querySelector('.atp-custom-toggle');
        if (toggle) { toggle.classList.add('active'); }
        showCustom(container, true);
        writeHidden(container, readCustom(container));
    }

    function decompose(minutes) {
        return {
            d: Math.floor(minutes / DAY),
            h: Math.floor((minutes % DAY) / HOUR),
            m: minutes % HOUR
        };
    }

    // Ajusta el picker a un valor (en la unidad del hidden: minutos u horas).
    function set(container, value) {
        if (!container) { return; }
        var minutes = fromHidden(parseFloat(value) || 0, unitOf(container));

        var dEl = container.querySelector('.atp-days');
        var hEl = container.querySelector('.atp-hours');
        var mEl = container.querySelector('.atp-mins');

        if (!minutes || minutes <= 0) {
            clearActive(container);
            showCustom(container, false);
            if (dEl) { dEl.value = ''; }
            if (hEl) { hEl.value = ''; }
            if (mEl) { mEl.value = ''; }
            writeHidden(container, 0);
            return;
        }

        var match = presetsOf(container).find(function (b) {
            return (parseInt(b.dataset.minutes, 10) || 0) === minutes;
        });
        if (match) {
            activatePreset(container, match);
            return;
        }

        // Sin campo "Días" (showDays:false), se pliegan los días en horas.
        var parts = dEl
            ? decompose(minutes)
            : { d: 0, h: Math.floor(minutes / HOUR), m: minutes % HOUR };
        if (dEl) { dEl.value = parts.d || ''; }
        if (hEl) { hEl.value = parts.h || ''; }
        if (mEl) { mEl.value = parts.m || ''; }
        activateCustom(container);
    }

    // ----- Eventos delegados -----
    document.addEventListener('click', function (e) {
        var preset = e.target.closest('.atp-preset');
        if (preset) {
            var pc = preset.closest('.advance-time-picker');
            if (pc) { e.preventDefault(); activatePreset(pc, preset); }
            return;
        }
        var toggle = e.target.closest('.atp-custom-toggle');
        if (toggle) {
            var tc = toggle.closest('.advance-time-picker');
            if (tc) { e.preventDefault(); activateCustom(tc); }
        }
    });

    document.addEventListener('input', function (e) {
        var el = e.target;
        if (el.classList && (el.classList.contains('atp-days') ||
            el.classList.contains('atp-hours') || el.classList.contains('atp-mins'))) {
            var container = el.closest('.advance-time-picker');
            if (container) { writeHidden(container, readCustom(container)); }
        }
    });

    window.AdvanceTimePicker = { set: set };
})();
