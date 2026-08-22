/**
 * FUNÇÕES UTILITÁRIAS E FORMATADORES
 */

// Converte texto/número em float válido ou null
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Formata números decimais (ex: 1.234,56)
const fmt = (v, dec) => v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });

// Formata valores em Reais (R$)
const brl = (v) => v == null ? '—' : 'R$ ' + fmt(v, 2);

// Remove acentos e converte para caixa baixa para buscas case-insensitive
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Formata inteiro com 2 dígitos (ex: 7 -> "07")
const dois = (n) => String(n).padStart(2, '0');

// Formata data e hora legível (pt-BR)
const quandoTxt = (d) => {
  if (!d) return '—';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '—' : t.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
  });
};

// Formata data sem hora (pt-BR)
const dataBr = (d) => {
  if (!d) return '';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('pt-BR');
};

// Identifica o nome do autor da alteração
const autorTxt = (r) => r.origem === 'importacao' ? 'importação inicial' : (r.autor_nome || r.autor || r.usuario || r.email || '—');

// Descreve o tipo de movimentação
const tipoTxt = (r) => {
  if (r.origem === 'importacao') return 'importação inicial';
  const d = Number(r.delta_pecas);
  if (Number.isFinite(d) && d !== 0) return d > 0 ? 'entrada' : 'saída';
  return r.tipo || r.operacao || '—';
};

// Extrai o número do estaleiro a partir dos parâmetros de URL (?e=7 ou /estaleiro/7)
function estaleiroDaUrl() {
  try {
    const qs = new URLSearchParams(window.location.search).get('e');
    if (qs && /^\d+$/.test(qs.trim())) return parseInt(qs, 10);
    const m = window.location.pathname.match(/estaleiro[\/-](\d+)/i);
    if (m) return parseInt(m[1], 10);
  } catch (e) { }
  return null;
}

// Configuração utilitária global do QR Code SVG
window.QRLite = {
  svg: function (text, opts) {
    var margin = (opts && opts.margin) || 0;
    var qr = qrcode(0, 'M');
    qr.addData(String(text));
    qr.make();
    var n = qr.getModuleCount();
    var size = n + margin * 2;
    var cells = '';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) cells += '<rect x="' + (c + margin) + '" y="' + (r + margin) + '" width="1" height="1"/>';
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges" fill="#16263F">' + cells + '</svg>';
  }
};
