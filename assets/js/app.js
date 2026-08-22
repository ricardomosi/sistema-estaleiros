/**
 * LÓGICA DA APLICAÇÃO E ENGINE REATIVA (DCLogic)
 * JPatrício Metais - Sistema de Catalogação de Tubos em Estaleiros
 */

/* ---------- DCLogic: Classe Base Reativa ---------- */
var renderPending = false;
function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  Promise.resolve().then(doRender);
}

class DCLogic {
  constructor() { this.state = {}; }
  setState(patch, cb) {
    var p = (typeof patch === 'function') ? patch(this.state) : (patch || {});
    Object.assign(this.state, p);
    scheduleRender();
    if (typeof cb === 'function') cb();
  }
  forceUpdate() { scheduleRender(); }
}
window.DCLogic = DCLogic;

/* ---------- Componente Principal da Aplicação ---------- */
class Component extends DCLogic {
  sessao = {
    access_token: 'mock-test-token',
    refresh_token: 'mock-test-refresh',
    expira_em: Date.now() + 86400000,
    user: { id: 'mock-test-user-id' },
    isMock: true,
  };

  state = {
    tela: typeof estaleiroDaUrl === 'function' && estaleiroDaUrl() ? 'qr' : 'home',
    modo: (typeof window !== 'undefined' && window.innerWidth <= 768) ? 'celular' : 'desktop',
    perfil: { papel: 'admin', nome: 'Administrador (JPatrício)', email: 'admin@jpatricio.com.br' },
    email: 'admin@jpatricio.com.br', senha: '', entrando: false, loginErro: '',
    estNum: typeof estaleiroDaUrl === 'function' ? estaleiroDaUrl() : 7,
    estOpcoes: [],
    status: 'idle',
    erroMsg: '',
    itens: [], numeros: {}, produtos: {}, estId: null, local: null,
    busca: '', abertos: {}, lotes: {},
    
    // Tela 2: Painel Geral do Vendedor
    pStatus: 'idle', pErro: '', pEsts: [], pItens: [], pNumeros: {}, pProdutos: {},
    pBusca: '', pSoPendentes: false, pAbertos: {},
    
    // Tela 3: Administração
    aAba: 'estoque', aMsg: '', aMsgTipo: 'ok',
    eEstNum: null, eStatus: 'idle', eLotes: [], eNumeros: {},
    precosBusca: '', precosSoVazios: false, precoEdits: {},
    pendEdits: {},
    relAba: 'movimentos', relDe: '', relAte: '', relStatus: 'idle', relRows: [],
    contasStatus: 'idle', contas: [], contasErro: '',
    novoNome: '', novoEmail: '', novaSenha: '', novoPapel: 'vendedor',
    urlBase: typeof URL_BASE_PADRAO !== 'undefined' ? URL_BASE_PADRAO : 'https://estoque.jpatricio.com.br/estaleiro',
    qrCopiado: null,
    eSoPendentes: false,
    loteAberto: false, loteId: null, loteProduto: '', loteQtd: '', loteTam: '',
    lotePeso: '', loteObs: '', loteErro: '', loteSalvando: false,
    produtoAberto: false, prodId: null, prodCodigo: '', prodDesc: '', prodKgm: '',
    prodPKg: '', prodPMt: '', prodPUn: '', prodErro: '', prodSalvando: false,
    prodDescarregar: false, prodEst: '', prodQtd: '', prodTam: '', prodPeso: '',
    matBusca: '',
    vazStatus: 'idle', vazRows: [], vazEncerrando: null,
    confirmId: null, confirmTexto: '', confirmTitulo: '', confirmTipo: 'lote',
    confirmProduto: null,
  };

  aviso(texto, tipo) {
    this.setState({ aMsg: texto, aMsgTipo: tipo || 'ok' });
    clearTimeout(this._avisoT);
    this._avisoT = setTimeout(() => this.setState({ aMsg: '' }), tipo === 'atencao' ? 11000 : 4500);
  }

  erroAdmin(e) {
    const m = String((e && e.message) || e);
    if (m.includes('sessão')) return;
    this.aviso(m.includes('permissão')
      ? 'Sem permissão para esta operação. O banco recusou a gravação.'
      : 'Não foi possível concluir: ' + m, 'erro');
  }

  irAba(id) {
    const S = this.state;
    this.setState({ aAba: id, aMsg: '' });
    if (id === 'estoque') {
      if (S.eEstNum != null && S.eStatus === 'idle') this.carregarEstoque();
      if (S.vazStatus === 'idle') this.carregarVazios();
    }
    if (id === 'relatorios' && S.relStatus === 'idle') this.carregarRelatorio();
    if (id === 'contas' && S.contasStatus === 'idle') this.carregarContas();
  }

  async carregarEstoque() {
    const n = this.state.eEstNum;
    if (n == null) return;
    this.setState({ eStatus: 'loading' });
    try {
      const ests = await this.estaleirosCache();
      const est = ests.find((e) => e.numero === n);
      if (!est) { this.setState({ eStatus: 'ok', eLotes: [], eNumeros: {} }); return; }
      const [lotes, numeros] = await Promise.all([
        this.api(`lotes?estaleiro_id=eq.${est.id}&select=id,produto_id,quantidade,` +
          'tamanho_m,peso_peca_kg,observacao&order=tamanho_m.desc&limit=500'),
        this.api(`itens_estaleiro?estaleiro_id=eq.${est.id}&select=numero,produto_id&limit=500`),
      ]);
      const mapa = {};
      numeros.forEach((r) => { mapa[r.produto_id] = r.numero; });
      this.setState({ eStatus: 'ok', eLotes: lotes, eNumeros: mapa, eEstId: est.id });
    } catch (e) {
      this.setState({ eStatus: 'ok', eLotes: [], eNumeros: {} });
      this.erroAdmin(e);
    }
  }

  async carregarVazios() {
    this.setState({ vazStatus: 'loading' });
    try {
      const rows = await this.api('vw_itens_vazios?select=*&order=dias_vazio.desc');
      this.setState({ vazStatus: 'ok', vazRows: rows || [] });
    } catch (e) {
      this.setState({ vazStatus: 'erro', vazRows: [] });
    }
  }

  async encerrarItem(row) {
    const ests = this.cache.estaleiros || [];
    const prods = this.cache.produtos || [];
    const est = ests.find((e) => Number(e.numero) === Number(row.estaleiro));
    const prod = prods.find((p) => String(p.codigo) === String(row.codigo));
    if (!est || !prod) {
      this.aviso('Não consegui identificar o estaleiro ou o material deste item.', 'erro');
      return;
    }
    const chave = est.id + '|' + prod.id;
    this.setState({ vazEncerrando: chave });
    try {
      await this.api('rpc/encerrar_item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_estaleiro: est.id, p_produto: prod.id }),
      });
      this.setState({ vazEncerrando: null });
      this.aviso(`Item encerrado. O número ${dois(row.n_pintado)} voltou a ficar livre no estaleiro ${dois(row.estaleiro)}.`);
      this.carregarVazios();
      if (this.state.eEstNum != null) this.carregarEstoque();
      this.invalidarPainel();
    } catch (e) {
      this.setState({ vazEncerrando: null });
      const m = String((e && e.message) || e);
      this.aviso(/lote/i.test(m)
        ? 'O banco recusou: ainda existe lote neste item. Exclua os lotes antes de encerrar.'
        : 'Não foi possível encerrar o item: ' + m, 'erro');
    }
  }

  abrirLote(l) {
    const virg = (v) => v == null ? '' : String(v).replace('.', ',');
    this.setState({
      loteAberto: true, loteErro: '', loteSalvando: false,
      loteId: l ? l.id : null,
      loteProduto: l ? l.produto_id : ((this.cache.produtos || [])[0] || {}).id || '',
      loteQtd: l ? String(l.quantidade ?? '') : '',
      loteTam: l ? virg(l.tamanho_m) : '',
      lotePeso: l ? virg(l.peso_peca_kg) : '',
      loteObs: l ? (l.observacao || '') : '',
    });
  }

  dec(t) {
    const s = String(t == null ? '' : t).trim();
    if (!s) return null;
    const v = Number(s.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(v) ? v : NaN;
  }

  abrirProduto(p) {
    const virg = (v) => v == null ? '' : String(v).replace('.', ',');
    const ests = this.cache.estaleiros || [];
    this.setState({
      produtoAberto: true, prodErro: '', prodSalvando: false,
      prodId: p ? p.id : null,
      prodCodigo: p ? (p.codigo || '') : '',
      prodDesc: p ? (p.descricao || '') : '',
      prodKgm: p ? virg(p.kg_por_metro) : '',
      prodPKg: p ? virg(p.preco_kg) : '',
      prodPMt: p ? virg(p.preco_mt) : '',
      prodPUn: p ? virg(p.preco_un) : '',
      prodDescarregar: false,
      prodEst: ests.length ? String(ests[0].numero) : '',
      prodQtd: '', prodTam: '', prodPeso: '',
    });
  }

  async salvarProdutoNovo() {
    const S = this.state;
    const codigo = S.prodCodigo.trim().toUpperCase();
    const desc = S.prodDesc.trim();
    const kgm = this.dec(S.prodKgm);
    const pKg = this.dec(S.prodPKg), pMt = this.dec(S.prodPMt), pUn = this.dec(S.prodPUn);
    if (!codigo) { this.setState({ prodErro: 'Informe o código.' }); return; }
    if ((this.cache.produtos || []).some((p) =>
      p.id !== S.prodId && (p.codigo || '').toUpperCase() === codigo)) {
      this.setState({ prodErro: 'Já existe um material com esse código.' }); return;
    }
    if (!desc) { this.setState({ prodErro: 'Informe a descrição.' }); return; }
    if (kgm == null || Number.isNaN(kgm) || kgm <= 0) {
      this.setState({ prodErro: 'Peso por metro deve ser um número maior que zero.' }); return;
    }
    for (const [v, r] of [[pKg, 'R$/kg'], [pMt, 'R$/mt'], [pUn, 'R$/un']]) {
      if (Number.isNaN(v) || (v != null && v <= 0)) {
        this.setState({ prodErro: `Valor inválido em ${r}. Deixe vazio se ainda não houver preço.` });
        return;
      }
    }
    let qtd = null, tam = null, peso = null;
    if (!S.prodId && S.prodDescarregar) {
      qtd = this.dec(S.prodQtd); tam = this.dec(S.prodTam); peso = this.dec(S.prodPeso);
      if (qtd == null || Number.isNaN(qtd) || qtd <= 0) {
        this.setState({ prodErro: 'Quantidade da descarga deve ser maior que zero.' }); return;
      }
      if (tam == null || Number.isNaN(tam) || tam <= 0) {
        this.setState({ prodErro: 'Tamanho da descarga deve ser maior que zero.' }); return;
      }
      if (Number.isNaN(peso)) { this.setState({ prodErro: 'Peso por peça inválido.' }); return; }
      if (peso == null) peso = kgm * tam;
    }
    this.setState({ prodSalvando: true, prodErro: '' });
    const corpo = {
      codigo, descricao: desc, kg_por_metro: kgm,
      preco_kg: pKg, preco_mt: pMt, preco_un: pUn,
    };
    if (pKg != null || pMt != null || pUn != null) {
      corpo.preco_data = new Date().toISOString().slice(0, 10);
    }
    try {
      if (S.prodId) {
        await this.api(`produtos?id=eq.${S.prodId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify(corpo),
        });
        const p = (this.cache.produtos || []).find((x) => x.id === S.prodId);
        if (p) Object.assign(p, corpo);
        this.setState({ produtoAberto: false, prodSalvando: false });
        this.aviso(`Material ${codigo} atualizado.`);
        this.invalidarPainel();
        return;
      }
      const criado = await this.api('produtos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(corpo),
      });
      const novo = Array.isArray(criado) ? criado[0] : criado;
      if (novo && this.cache.produtos) this.cache.produtos.push(novo);
      if (novo && S.prodDescarregar) {
        const ests = this.cache.estaleiros || [];
        const est = ests.find((e) => String(e.numero) === String(S.prodEst));
        if (est) {
          await this.garantirNumero(est.id, novo.id);
          await this.api('lotes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({
              estaleiro_id: est.id, produto_id: novo.id,
              quantidade: qtd, tamanho_m: tam, peso_peca_kg: peso, observacao: null,
            }),
          });
          if (this.state.eEstNum === est.numero) this.carregarEstoque();
        }
      }
      this.setState({ produtoAberto: false, prodSalvando: false });
      this.aviso(S.prodDescarregar
        ? `Material ${codigo} cadastrado e descarregado no estaleiro ${S.prodEst}.`
        : `Material ${codigo} cadastrado.`);
      const chk = this.checarPreco(pKg, pMt, kgm);
      if (chk.ruim) this.aviso(chk.aviso, 'erro');
      this.invalidarPainel();
    } catch (e) {
      this.setState({ prodSalvando: false, prodErro: String((e && e.message) || e) });
    }
  }

  async proximoNumero(estId) {
    const j = await this.api('rpc/proximo_numero', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_estaleiro: estId }),
    });
    const n = Number(Array.isArray(j) ? j[0] : j);
    if (!Number.isFinite(n) || n <= 0) throw new Error('o banco não devolveu um número válido');
    return n;
  }

  async garantirNumero(estId, produtoId) {
    const ja = await this.api(
      `itens_estaleiro?estaleiro_id=eq.${estId}&produto_id=eq.${produtoId}&select=numero&limit=1`);
    if (ja && ja.length) return Number(ja[0].numero);
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      const numero = await this.proximoNumero(estId);
      try {
        await this.api('itens_estaleiro', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ estaleiro_id: estId, produto_id: produtoId, numero }),
        });
        return numero;
      } catch (e) {
        const dup = e && (e.code === '23505' || e.status === 409 ||
          /duplicat|unique|já existe/i.test(String(e.message || '')));
        if (!dup || tentativa === 3) throw e;
      }
    }
  }

  async salvarLote() {
    const S = this.state;
    const qtd = this.dec(S.loteQtd), tam = this.dec(S.loteTam), peso = this.dec(S.lotePeso);
    if (!S.loteProduto) { this.setState({ loteErro: 'Escolha o material.' }); return; }
    if (qtd == null || Number.isNaN(qtd) || qtd <= 0) {
      this.setState({ loteErro: 'Quantidade deve ser um número maior que zero.' }); return;
    }
    if (tam == null || Number.isNaN(tam) || tam <= 0) {
      this.setState({ loteErro: 'Tamanho deve ser um número maior que zero.' }); return;
    }
    if (Number.isNaN(peso)) { this.setState({ loteErro: 'Peso por peça inválido.' }); return; }
    this.setState({ loteSalvando: true, loteErro: '' });
    const corpo = {
      produto_id: S.loteProduto, quantidade: qtd, tamanho_m: tam,
      peso_peca_kg: peso, observacao: S.loteObs.trim() || null,
    };
    try {
      if (S.loteId) {
        await this.api(`lotes?id=eq.${S.loteId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify(corpo),
        });
      } else {
        await this.garantirNumero(S.eEstId, S.loteProduto);
        await this.api('lotes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ ...corpo, estaleiro_id: S.eEstId }),
        });
      }
      this.setState({ loteAberto: false, loteSalvando: false });
      this.aviso(S.loteId ? 'Lote atualizado.' : 'Lote adicionado.');
      this.carregarEstoque();
      this.invalidarPainel();
    } catch (e) {
      this.setState({ loteSalvando: false, loteErro: String((e && e.message) || e) });
    }
  }

  async excluirLote() {
    const id = this.state.confirmId;
    const tipo = this.state.confirmTipo;
    this.setState({ confirmId: null });
    if (id == null) return;
    if (tipo === 'produto') {
      try {
        await this.api(`produtos?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        if (this.cache.produtos) {
          this.cache.produtos = this.cache.produtos.filter((p) => p.id !== id);
        }
        this.aviso('Material excluído.');
        this.invalidarPainel();
      } catch (e) {
        this.aviso('Não foi possível excluir: ' + String((e && e.message) || e) +
          '. Se houver lotes ligados a ele, inative em vez de excluir.', 'erro');
      }
      return;
    }
    const pid = this.state.confirmProduto;
    const irmaos = (this.state.eLotes || []).filter((l) => l.produto_id === pid && l.id !== id).length;
    const numPintado = pid ? (this.state.eNumeros || {})[pid] : null;
    try {
      await this.api(`lotes?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (pid && irmaos === 0 && numPintado != null) {
        this.aviso(`Este era o último material com o número ${dois(numPintado)} neste estaleiro. ` +
          'O número segue reservado. Encerre o item se o tubo não vai voltar.', 'atencao');
      } else {
        this.aviso('Lote excluído. A exclusão ficou registrada na trilha.');
      }
      this.setState({ confirmProduto: null });
      this.carregarEstoque();
      this.carregarVazios();
      this.invalidarPainel();
    } catch (e) { this.erroAdmin(e); }
  }

  invalidarPainel() {
    this.setState({ pStatus: 'idle' });
    if (this.state.tela === 'admin' || this.state.tela === 'vendedor') this.carregarPainel();
  }

  async alternarAtivoProduto(p) {
    const ativo = p.ativo !== false;
    try {
      await this.api(`produtos?id=eq.${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ ativo: !ativo }),
      });
      p.ativo = !ativo;
      this.aviso(ativo ? 'Material inativado.' : 'Material reativado.');
      this.forceUpdate();
    } catch (e) {
      this.aviso('Não foi possível mudar a situação: ' + String((e && e.message) || e) +
        '. A tabela produtos precisa da coluna ativo.', 'erro');
    }
  }

  async salvarProduto(id, campos, rotulo) {
    try {
      await this.api(`produtos?id=eq.${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(campos),
      });
      const p = (this.cache.produtos || []).find((x) => x.id === id);
      if (p) Object.assign(p, campos);
      this.aviso((rotulo || 'Registro') + ' gravado.');
      this.forceUpdate();
    } catch (e) { this.erroAdmin(e); }
  }

  irTela(id) {
    this.setState({ tela: id });
    if (id === 'vendedor' || id === 'admin') {
      this.carregarPainel();
    }
    if (id === 'admin') {
      this.irAba(this.state.aAba || 'estoque');
    }
  }

  async carregarPainel() {
    if (!this.sessao) return;
    this.setState({ pStatus: 'loading', pErro: '' });
    try {
      const [ests, itens, numeros, produtos] = await Promise.all([
        this.estaleirosCache(),
        this.api('vw_estaleiro_itens?select=*&order=estaleiro&limit=2000'),
        this.api('itens_estaleiro?select=numero,produto_id,estaleiro_id&limit=2000'),
        this.produtosCache(),
      ]);
      const mapaNum = {}, mapaProd = {};
      (numeros || []).forEach((r) => { mapaNum[r.estaleiro_id + '|' + r.produto_id] = r.numero; });
      (produtos || []).forEach((p) => { mapaProd[p.id] = p; });
      this.setState({
        pStatus: 'ok', pEsts: ests || [], pItens: itens || [],
        pNumeros: mapaNum, pProdutos: mapaProd,
      });
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (msg.includes('sessão')) return;
      this.setState({ pStatus: msg.includes('permissão') ? 'semacesso' : 'erro', pErro: msg });
    }
  }

  async carregarContas() {
    this.setState({ contasStatus: 'loading', contasErro: '' });
    try {
      const j = await this.contasApi({ acao: 'listar' });
      const lista = Array.isArray(j) ? j : (j && (j.usuarios || j.contas)) || [];
      this.setState({ contasStatus: 'ok', contas: lista });
    } catch (e) {
      const m = String((e && e.message) || e);
      if (m.includes('sessão')) return;
      this.setState({ contasStatus: 'erro', contasErro: 'Não foi possível listar as contas: ' + m });
    }
  }

  async criarConta() {
    const S = this.state;
    const email = S.novoEmail.trim();
    if (!S.novoNome.trim()) { this.aviso('Informe o nome.', 'erro'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { this.aviso('E-mail inválido.', 'erro'); return; }
    if (S.novaSenha.length < 8) { this.aviso('A senha precisa de pelo menos 8 caracteres.', 'erro'); return; }
    try {
      await this.contasApi({
        acao: 'criar', nome: S.novoNome.trim(), email,
        senha: S.novaSenha, papel: S.novoPapel,
      });
      this.setState({ novoNome: '', novoEmail: '', novaSenha: '', novoPapel: 'vendedor' });
      this.aviso('Conta criada.');
      this.carregarContas();
    } catch (e) { this.erroAdmin(e); }
  }

  async atualizarConta(uid, campos, msg) {
    try {
      await this.contasApi({ acao: 'atualizar', user_id: uid, ...campos });
      this.aviso(msg || 'Conta atualizada.');
      this.carregarContas();
    } catch (e) { this.erroAdmin(e); }
  }

  async novaSenhaConta(uid, email) {
    const senha = window.prompt('Nova senha para ' + (email || 'esta conta') + ' (mín. 8 caracteres):');
    if (senha == null) return;
    if (senha.length < 8) { this.aviso('A senha precisa de pelo menos 8 caracteres.', 'erro'); return; }
    try {
      await this.contasApi({ acao: 'nova_senha', user_id: uid, senha });
      this.aviso('Senha alterada.');
    } catch (e) { this.erroAdmin(e); }
  }

  urlDoEstaleiro(n) {
    const base = String(this.state.urlBase || URL_BASE_PADRAO).trim().replace(/\/+$/, '');
    if (base.includes('?e=')) return base.replace(/\?e=\d+/, `?e=${n}`);
    if (base.includes('?')) return `${base}&e=${n}`;
    return `${base}/?e=${n}`;
  }

  imprimirPlacas(numeros) {
    const ests = this.cache.estaleiros || [];
    const logo = (window.__resources && window.__resources.logoJP) || '';
    const hoje = new Date().toLocaleDateString('pt-BR');
    const paginas = numeros.map((n) => {
      const est = ests.find((e) => e.numero === n) || {};
      const url = this.urlDoEstaleiro(n);
      let qr = '';
      try { qr = window.QRLite.svg(url, { margin: 1 }); } catch (e) { qr = ''; }
      return `<section>
<div style="height:14px;background:#EE6B33;"></div>
<div style="background:#0E2340;padding:22px 28px;display:flex;align-items:center;justify-content:space-between;gap:20px;">
<img src="${logo}" alt="JPatrício Metais" style="height:74px;width:auto;display:block;" />
<div style="text-align:right;">
<div style="font-size:13px;font-weight:800;letter-spacing:0.22em;color:#EE6B33;">ESTALEIRO</div>
<div style="font-family:'Barlow Condensed',sans-serif;font-size:96px;font-weight:700;line-height:0.85;color:#FFFFFF;">${dois(n)}</div>
</div>
</div>
<div style="padding:24px 28px;background:#F1F4F8;border-bottom:3px solid #0E2340;text-align:center;">
<div style="font-size:13px;font-weight:800;letter-spacing:0.22em;color:#EE6B33;">LOCALIZAÇÃO</div>
<div style="font-family:'Barlow Condensed',sans-serif;font-size:64px;font-weight:700;line-height:1;color:#0E2340;margin-top:8px;">${est.localizacao || '—'}</div>
</div>
<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;padding:30px 28px;">
<div style="width:372px;height:372px;background:#FFFFFF;border:7px solid #0E2340;padding:10px;">${qr}</div>
<div style="max-width:470px;text-align:center;">
<div style="font-size:24px;font-weight:900;color:#0E2340;line-height:1.2;">APONTE A CÂMERA DO CELULAR</div>
<div style="font-size:17px;font-weight:600;color:#46617F;margin-top:8px;line-height:1.35;">Veja todos os tubos deste estaleiro com descrição, quantidades e preços por KG, MT e unidade.</div>
</div>
</div>
<div style="padding:14px 28px;background:#0E2340;display:flex;align-items:center;justify-content:space-between;gap:16px;">
<div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#8FA3BC;">USO OBRIGATÓRIO DE EPI · NÃO REMOVER ESTA PLACA · ${hoje}</div>
<div style="font-size:11px;font-weight:800;letter-spacing:0.1em;color:#EE6B33;">JPATRÍCIO METAIS</div>
</div>
<div style="height:10px;background:#EE6B33;"></div>
</section>`;
    }).join('');

    const doc = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8" />
<title>Placas — JPatrício Metais</title>
<link href="https://cdn.jsdelivr.net/npm/@fontsource/archivo@5/600.css" rel="stylesheet" />
<link href="https://cdn.jsdelivr.net/npm/@fontsource/archivo@5/700.css" rel="stylesheet" />
<link href="https://cdn.jsdelivr.net/npm/@fontsource/archivo@5/800.css" rel="stylesheet" />
<link href="https://cdn.jsdelivr.net/npm/@fontsource/archivo@5/900.css" rel="stylesheet" />
<link href="https://cdn.jsdelivr.net/npm/@fontsource/barlow-condensed@5/700.css" rel="stylesheet" />
<style>
@page { size: A4; margin: 0; }
html, body { margin: 0; padding: 0; background: #55606E; }
section { width: 210mm; height: 297mm; margin: 0 auto 8mm; background: #FFFFFF;
font-family: Archivo, sans-serif; display: flex; flex-direction: column; overflow: hidden; }
section svg { width: 100%; height: 100%; display: block; }
@media print { body { background: #FFFFFF; } section { margin: 0; break-after: page; } }
</style></head><body>
${paginas}
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 400); });</script>
</body></html>`;

    const w = window.open('', '_blank');
    if (!w) { this.aviso('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.', 'erro'); return; }
    w.document.write(doc);
    w.document.close();
  }

  checarPreco(pKg, pMt, kgm) {
    if (pKg == null || pMt == null || !kgm) return { ruim: false, aviso: '' };
    const esperado = pKg * kgm;
    if (!(esperado > 0)) return { ruim: false, aviso: '' };
    const ruim = Math.abs(pMt - esperado) / esperado > 0.02;
    return {
      ruim,
      aviso: ruim ? `Preço por metro (${brl(pMt)}) diverge do cálculo ${brl(pKg)}/kg × ${fmt(kgm, 3)} kg/m = ${brl(esperado)}. Confirme antes de cotar.` : '',
    };
  }

  async carregarRelatorio() {
    const S = this.state;
    const VIEWS = {
      movimentos: 'vw_rel_movimentos', precos: 'vw_rel_precos',
      auditoria: 'vw_rel_auditoria', usuarios: 'vw_rel_por_usuario',
    };
    const view = VIEWS[S.relAba] || VIEWS.movimentos;
    this.setState({ relStatus: 'loading' });
    try {
      const f = [];
      if (S.relAba !== 'usuarios') {
        if (S.relDe) f.push(`em=gte.${S.relDe}T00:00:00`);
        if (S.relAte) f.push(`em=lte.${S.relAte}T23:59:59`);
        f.push('order=em.desc');
      }
      f.push('select=*', 'limit=500');
      const rows = await this.api(`${view}?${f.join('&')}`);
      this.setState({ relStatus: 'ok', relRows: rows });
    } catch (e) {
      this.setState({ relStatus: 'ok', relRows: [] });
      this.erroAdmin(e);
    }
  }

  async contasApi(corpo) {
    if (this.sessao && this.sessao.isMock) {
      if (corpo && corpo.acao === 'listar') {
        if (!this._mockContas) {
          this._mockContas = [
            { user_id: 'mock-1', nome: 'Administrador (Modo de Teste)', email: 'admin@jpatricio.com.br', papel: 'admin', ativo: true },
            { user_id: 'mock-2', nome: 'Vendedor (Modo de Teste)', email: 'vendedor@jpatricio.com.br', papel: 'vendedor', ativo: true }
          ];
        }
        return this._mockContas;
      }
      if (corpo && corpo.acao === 'criar') {
        const nova = { user_id: 'mock-' + Date.now(), nome: corpo.nome, email: corpo.email, papel: corpo.papel, ativo: true };
        if (!this._mockContas) this._mockContas = [];
        this._mockContas.push(nova);
        return { ok: true, usuario: nova };
      }
      if (corpo && corpo.acao === 'atualizar') {
        if (this._mockContas) {
          const u = this._mockContas.find((x) => x.user_id === corpo.user_id);
          if (u) Object.assign(u, corpo);
        }
        return { ok: true };
      }
      return { ok: true };
    }

    if (!this.sessao) throw new Error('sem sessão');
    if (this.sessao.expira_em && Date.now() > this.sessao.expira_em - 30000) await this.renovar();
    const r = await fetch(`${SB_URL}/functions/v1/gerenciar-contas`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: 'Bearer ' + this.sessao.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(corpo),
    });
    const txt = await r.text();
    let j = null;
    try { j = txt ? JSON.parse(txt) : null; } catch (e) { }
    if (r.status === 401) { this.encerrarSessao('expirada'); throw new Error('sessão expirada'); }
    if (r.status === 403) throw new Error('sem permissão');
    if (r.status === 404) throw new Error('a função gerenciar-contas não está publicada no Supabase');
    if (!r.ok) throw new Error((j && (j.erro || j.error || j.message)) || 'HTTP ' + r.status);
    return j;
  }

  mockApi(path, opts) {
    const cleanPath = String(path || '').split('?')[0];

    if (cleanPath === 'estaleiros') {
      return Promise.resolve(Array.from({ length: 46 }, (_, i) => ({
        id: `est-${i + 1}`,
        numero: i + 1,
        localizacao: i === 0 ? 'Galpão Central' : 'Pátio de Estaleiro',
      })));
    }

    if (cleanPath === 'produtos') {
      if (!this._mockProdutos) {
        this._mockProdutos = [
          { id: 'prod-1', codigo: 'TUB101', descricao: 'Tubo Redondo 2" x 2,00 mm', kg_por_metro: 2.45, preco_kg: 8.50, preco_mt: 20.82, preco_un: 124.95, preco_data: '2026-08-01', ativo: true },
          { id: 'prod-2', codigo: 'TUB102', descricao: 'Tubo Quadrado 50x50 x 3,00 mm', kg_por_metro: 4.12, preco_kg: 8.90, preco_mt: 36.67, preco_un: 220.00, preco_data: '2026-08-01', ativo: true },
          { id: 'prod-3', codigo: 'TUB103', descricao: 'Tubo Retangular 80x40 x 2,50 mm', kg_por_metro: 4.48, preco_kg: 8.70, preco_mt: 38.98, preco_un: 233.85, preco_data: '2026-08-01', ativo: true },
        ];
      }
      if (opts && opts.method === 'POST') {
        let b = {};
        try { b = JSON.parse(opts.body); } catch (e) {}
        const np = { id: 'prod-' + Date.now(), ...b, ativo: true };
        this._mockProdutos.push(np);
        return Promise.resolve([np]);
      }
      return Promise.resolve(this._mockProdutos);
    }

    if (cleanPath === 'itens_estaleiro') {
      return Promise.resolve([
        { id: 'ie-1', estaleiro_id: 'est-7', produto_id: 'prod-1', numero: 1 },
        { id: 'ie-2', estaleiro_id: 'est-7', produto_id: 'prod-2', numero: 2 },
        { id: 'ie-3', estaleiro_id: 'est-7', produto_id: 'prod-3', numero: 3 },
      ]);
    }

    if (cleanPath === 'lotes') {
      if (!this._mockLotes) {
        this._mockLotes = [
          { id: 'lote-1', estaleiro_id: 'est-7', produto_id: 'prod-1', quantidade: 10, tamanho_m: 6.0, peso_peca_kg: 14.7, observacao: 'Lote inicial A' },
          { id: 'lote-2', estaleiro_id: 'est-7', produto_id: 'prod-2', quantidade: 5, tamanho_m: 6.0, peso_peca_kg: 24.72, observacao: 'Lote inicial B' },
          { id: 'lote-3', estaleiro_id: 'est-7', produto_id: 'prod-3', quantidade: 8, tamanho_m: 6.0, peso_peca_kg: 26.88, observacao: 'Lote inicial C' },
        ];
      }
      if (opts && opts.method === 'POST') {
        let b = {};
        try { b = JSON.parse(opts.body); } catch (e) {}
        const nl = { id: 'lote-' + Date.now(), ...b };
        this._mockLotes.push(nl);
        return Promise.resolve([nl]);
      }
      if (opts && opts.method === 'DELETE') {
        const idMatch = (path.match(/id=eq\.([^&]+)/) || [])[1];
        if (idMatch) this._mockLotes = this._mockLotes.filter((x) => x.id !== idMatch);
        return Promise.resolve(null);
      }
      return Promise.resolve(this._mockLotes);
    }

    if (cleanPath === 'vw_estaleiro_itens') {
      return Promise.resolve([
        { estaleiro: 7, estaleiro_id: 'est-7', produto_id: 'prod-1', codigo: 'TUB101', descricao: 'Tubo Redondo 2" x 2,00 mm', kg_por_metro: 2.45, n_pintado: 1, lotes: 1, total_pecas: 10, total_mt: 60.0, total_kg: 147.0, pend_sem_descricao: false, pend_sem_codigo: false, pend_sem_peso: false },
        { estaleiro: 7, estaleiro_id: 'est-7', produto_id: 'prod-2', codigo: 'TUB102', descricao: 'Tubo Quadrado 50x50 x 3,00 mm', kg_por_metro: 4.12, n_pintado: 2, lotes: 1, total_pecas: 5, total_mt: 30.0, total_kg: 123.6, pend_sem_descricao: false, pend_sem_codigo: false, pend_sem_peso: false },
        { estaleiro: 7, estaleiro_id: 'est-7', produto_id: 'prod-3', codigo: 'TUB103', descricao: 'Tubo Retangular 80x40 x 2,50 mm', kg_por_metro: 4.48, n_pintado: 3, lotes: 1, total_pecas: 8, total_mt: 48.0, total_kg: 215.04, pend_sem_descricao: false, pend_sem_codigo: false, pend_sem_peso: false },
      ]);
    }

    if (cleanPath === 'vw_itens_vazios') {
      return Promise.resolve([
        { estaleiro: 1, n_pintado: 4, codigo: 'TUB101', descricao: 'Tubo Redondo 2" x 2,00 mm', vazio_desde: new Date().toISOString(), dias_vazio: 5 }
      ]);
    }

    if (cleanPath === 'vw_rel_movimentos') {
      return Promise.resolve([
        { id: 'mov-1', em: new Date().toISOString(), tipo: 'entrada', estaleiro: 7, material: 'Tubo Redondo 2" x 2,00 mm', codigo: 'TUB101', delta_pecas: 10, delta_mt: 60, delta_kg: 147, autor: 'Administrador (Modo de Teste)', origem: 'sistema' }
      ]);
    }

    if (cleanPath === 'vw_rel_precos') {
      return Promise.resolve([
        { id: 'pr-1', em: new Date().toISOString(), material: 'Tubo Redondo 2" x 2,00 mm', codigo: 'TUB101', campo: 'preco_kg', valor_antes: 8.00, valor_depois: 8.50, autor: 'Administrador (Modo de Teste)' }
      ]);
    }

    if (cleanPath === 'vw_rel_auditoria') {
      return Promise.resolve([
        { id: 'aud-1', em: new Date().toISOString(), tabela: 'lotes', operacao: 'INSERT', registro: 'Adicionou lote de 10 peças (TUB101)', autor: 'Administrador (Modo de Teste)' }
      ]);
    }

    if (cleanPath === 'vw_rel_por_usuario') {
      return Promise.resolve([
        { nome: 'Administrador (Modo de Teste)', email: 'admin@jpatricio.com.br', alteracoes: 5, ultima_em: new Date().toISOString() }
      ]);
    }

    if (cleanPath === 'rpc/proximo_numero') return Promise.resolve(4);
    if (cleanPath === 'rpc/encerrar_item') return Promise.resolve(true);

    return Promise.resolve([]);
  }

  async api(path, opts) {
    const s = this.sessao;
    if (!s) throw new Error('sem sessão');
    if (s.isMock) return this.mockApi(path, opts);
    if (s.expira_em && Date.now() > s.expira_em - 30000) await this.renovar();
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
      ...opts,
      headers: {
        apikey: SB_KEY,
        Authorization: 'Bearer ' + this.sessao.access_token,
        Accept: 'application/json',
        ...(opts && opts.headers),
      },
      cache: 'no-store',
    });
    if (r.status === 401) { this.encerrarSessao('expirada'); throw new Error('sessão expirada'); }
    if (r.status === 403) throw new Error('sem permissão');
    if (!r.ok) {
      let j = null;
      try { const t = await r.text(); j = t ? JSON.parse(t) : null; } catch (e) { }
      const err = new Error((j && (j.message || j.hint)) || 'HTTP ' + r.status);
      err.status = r.status;
      err.code = j && j.code;
      throw err;
    }
    if (r.status === 204) return null;
    const txt = await r.text();
    if (!txt) return null;
    return JSON.parse(txt);
  }

  guardarSessao(j) {
    this.sessao = {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expira_em: Date.now() + (Number(j.expires_in) || 3600) * 1000,
      user: j.user,
    };
  }

  async renovar() {
    const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.sessao.refresh_token }),
    });
    if (!r.ok) { this.encerrarSessao('expirada'); throw new Error('sessão expirada'); }
    this.guardarSessao(await r.json());
  }

  encerrarSessao(motivo) {
    this.sessao = null;
    this.cache = { estaleiros: null, produtos: null };
    this.setState({
      perfil: null, senha: '', status: 'idle', itens: [], numeros: {}, produtos: {},
      abertos: {}, lotes: {}, busca: '',
      pStatus: 'idle', pEsts: [], pItens: [], pNumeros: {}, pProdutos: {},
      pBusca: '', pSoPendentes: false, pAbertos: {},
      loginErro: motivo === 'expirada' ? 'Sua sessão expirou. Entre novamente.' : '',
    });
  }

  async entrar(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    const { email, senha } = this.state;
    if (!email.trim() || !senha) {
      this.setState({ loginErro: 'Informe e-mail e senha.' });
      return;
    }

    const eNorm = email.trim().toLowerCase();
    const sNorm = senha.trim();

    // Login ADM e Vendedor para Modo de Teste Local
    const isTestAdmin = (eNorm === 'admin' || eNorm === 'admin@jpatricio.com.br') &&
                        (sNorm === 'admin' || sNorm === 'admin123' || sNorm === '123456' || sNorm === '123');
    const isTestVendedor = (eNorm === 'vendedor' || eNorm === 'vendedor@jpatricio.com.br') &&
                           (sNorm === 'vendedor' || sNorm === 'vendedor123' || sNorm === '123456' || sNorm === '123');

    if (isTestAdmin || isTestVendedor) {
      const papel = isTestAdmin ? 'admin' : 'vendedor';
      const nome = isTestAdmin ? 'Administrador (Modo de Teste)' : 'Vendedor (Modo de Teste)';
      const mail = isTestAdmin ? 'admin@jpatricio.com.br' : 'vendedor@jpatricio.com.br';
      this.sessao = {
        access_token: 'mock-test-token',
        refresh_token: 'mock-test-refresh',
        expira_em: Date.now() + 86400000,
        user: { id: 'mock-test-user-id' },
        isMock: true,
      };
      this.setState({
        perfil: { papel, nome, email: mail },
        entrando: false,
        senha: '',
        loginErro: '',
      });
      this.carregar();
      this.carregarOpcoes();
      this.carregarPainel();
      return;
    }

    this.setState({ entrando: true, loginErro: '' });
    try {
      const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password: senha }),
      });
      if (!r.ok) {
        this.setState({
          entrando: false,
          senha: '',
          loginErro: 'E-mail ou senha incorretos. (Dica de Teste: Use admin@jpatricio.com.br / admin)',
        });
        return;
      }
      this.guardarSessao(await r.json());
      const perfis = await this.api(
        `usuarios?select=papel,nome,email&user_id=eq.${encodeURIComponent(this.sessao.user.id)}`);
      if (!perfis.length) {
        this.sessao = null;
        this.setState({ entrando: false, senha: '', loginErro: 'Acesso não liberado. Procure o administrador.' });
        return;
      }
      this.setState({ perfil: perfis[0], entrando: false, senha: '', loginErro: '' });
      this.carregar();
      this.carregarOpcoes();
      this.carregarPainel();
    } catch (e) {
      this.setState({
        entrando: false,
        senha: '',
        loginErro: 'Não foi possível conectar ao banco de dados. Use admin@jpatricio.com.br / admin para testar offline.',
      });
    }
  }

  async carregarOpcoes() {
    try {
      this.setState({ estOpcoes: await this.estaleirosCache() });
    } catch (e) { }
  }

  cache = { estaleiros: null, produtos: null };
  async estaleirosCache() {
    if (!this.cache.estaleiros) {
      this.cache.estaleiros = await this.api('estaleiros?select=id,numero,localizacao&order=numero');
    }
    return this.cache.estaleiros;
  }

  async produtosCache() {
    if (!this.cache.produtos) {
      this.cache.produtos = await this.api('produtos?select=*&limit=2000');
    }
    return this.cache.produtos;
  }

  async carregar() {
    let n = this.state.estNum;
    if (n == null) {
      if (this.state.tela === 'home') {
        this.setState({ status: 'idle' });
        return;
      }
      n = 7;
      this.setState({ estNum: 7 });
    }
    this.setState({ status: 'loading', abertos: {}, lotes: {}, busca: '' });
    try {
      const [ests, itens, produtos] = await Promise.all([
        this.estaleirosCache(),
        this.api(`vw_estaleiro_itens?select=*&estaleiro=eq.${n}`),
        this.produtosCache(),
      ]);
      const est = (ests || []).find((e) => Number(e.numero) === Number(n));
      if (!est) { this.setState({ status: 'notfound' }); return; }
      const [numeros, lotesRows] = await Promise.all([
        this.api(`itens_estaleiro?select=numero,produto_id&estaleiro_id=eq.${est.id}`),
        this.api(`lotes?estaleiro_id=eq.${est.id}` +
          '&select=produto_id,quantidade,tamanho_m,peso_peca_kg,observacao&order=tamanho_m.desc'),
      ]);
      const mapaNum = {};
      (numeros || []).forEach((r) => { mapaNum[r.produto_id] = r.numero; });
      const mapaProd = {};
      (produtos || []).forEach((p) => { mapaProd[p.id] = p; });
      const lotes = {};
      (lotesRows || []).forEach((r) => {
        if (!lotes[r.produto_id]) lotes[r.produto_id] = { status: 'ok', rows: [] };
        lotes[r.produto_id].rows.push(r);
      });
      this.setState({
        status: (itens && itens.length) ? 'ok' : 'vazio',
        itens: itens || [], numeros: mapaNum, produtos: mapaProd, lotes,
        estId: est.id, local: est.localizacao,
      });
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (msg.includes('sessão')) return;
      this.setState({ status: msg.includes('permissão') ? 'semacesso' : 'erro', erroMsg: msg });
    }
  }

  async carregarLotes(pid) {
    const { estId } = this.state;
    if (!estId) return;
    this.setState((s) => ({ lotes: { ...s.lotes, [pid]: { status: 'loading' } } }));
    try {
      const rows = await this.api(`lotes?estaleiro_id=eq.${estId}&produto_id=eq.${pid}` +
        '&select=quantidade,tamanho_m,peso_peca_kg,observacao&order=tamanho_m.desc');
      this.setState((s) => ({ lotes: { ...s.lotes, [pid]: { status: 'ok', rows } } }));
    } catch (e) {
      this.setState((s) => ({ lotes: { ...s.lotes, [pid]: { status: 'erro' } } }));
    }
  }

  toggle(pid) {
    const aberto = !!this.state.abertos[pid];
    this.setState((s) => ({ abertos: aberto ? {} : { [pid]: true } }));
    if (!aberto && !this.state.lotes[pid]) this.carregarLotes(pid);
  }

  painelVals() {
    const S = this.state;
    const pend = (i) => !!i.pend_sem_descricao || !!i.pend_sem_codigo ||
      !!i.pend_sem_peso || num(i.total_kg) == null;
    const itens = S.pItens || [];
    const somaPc = itens.reduce((s, i) => s + (num(i.total_pecas) || 0), 0);
    const somaMt = itens.reduce((s, i) => s + (num(i.total_mt) || 0), 0);
    const somaKg = itens.reduce((s, i) => s + (num(i.total_kg) || 0), 0);
    const nPend = itens.filter(pend).length;
    const prods = Object.values(S.pProdutos || {});
    const comPreco = prods.filter((p) =>
      num(p.preco_kg) != null || num(p.preco_mt) != null || num(p.preco_un) != null).length;
    const boxStyle = (i) => `padding:14px 18px;border-left:${i ? '1px solid #E4EAF1' : 'none'};`;
    const metricas = [
      { r: 'ESTALEIROS', v: fmt(S.pEsts.length, 0) },
      { r: 'MATERIAIS', v: fmt(itens.length, 0) },
      { r: 'PEÇAS', v: fmt(somaPc, 0) },
      { r: 'METROS', v: fmt(somaMt, 2) },
      { r: 'QUILOS', v: fmt(somaKg, 2) },
      { r: 'COM PENDÊNCIA', v: fmt(nPend, 0), alerta: nPend > 0 },
      { r: 'COM PREÇO', v: `${comPreco} de ${prods.length}`, alerta: comPreco < prods.length },
    ].map((m, i) => ({
      rotulo: m.r, valor: m.v, boxStyle: boxStyle(i),
      valorStyle: `font-size:23px;font-weight:800;margin-top:4px;font-variant-numeric:tabular-nums;color:${m.alerta ? '#8A4B0B' : '#16263F'};`,
    }));
    const q = semAcento(S.pBusca).trim();
    const porEst = new Map();
    itens.forEach((i) => {
      if (!porEst.has(i.estaleiro)) porEst.set(i.estaleiro, []);
      porEst.get(i.estaleiro).push(i);
    });
    const linhas = [];
    S.pEsts.forEach((e) => {
      const todos = porEst.get(e.numero) || [];
      const vis = todos.filter((i) => {
        if (S.pSoPendentes && !pend(i)) return false;
        if (!q) return true;
        return semAcento(i.codigo).includes(q) || semAcento(i.descricao).includes(q) ||
          String(e.numero) === q || dois(e.numero) === q;
      });
      if (vis.length) linhas.push({ est: e, itens: vis, todos });
    });
    const vazios = S.pEsts.filter((e) => !(porEst.get(e.numero) || []).length).map((e) => dois(e.numero));
    const visiveis = linhas.reduce((s, l) => s + l.itens.length, 0);
    return {
      painelCarregando: S.pStatus === 'loading' || S.pStatus === 'idle',
      painelErro: S.pStatus === 'erro' || S.pStatus === 'semacesso',
      painelErroTitulo: S.pStatus === 'semacesso' ? 'Sem permissão' : 'Não foi possível ler o estoque',
      painelErroTexto: S.pStatus === 'semacesso'
        ? 'Sua conta não tem acesso a esta visão. Fale com o administrador.'
        : 'Verifique a conexão e tente novamente.',
      painelOk: S.pStatus === 'ok',
      recarregarPainel: () => this.carregarPainel(),
      painelControlesStyle: S.modo === 'celular'
        ? 'display:flex;flex-direction:column;align-items:stretch;gap:9px;margin-bottom:14px;'
        : 'display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap;',
      painelBuscaStyle: S.modo === 'celular'
        ? 'width:100%;padding:12px 14px;font-family:Archivo,sans-serif;font-size:15px;font-weight:600;color:#16263F;background:#FFFFFF;border:2px solid #D3DCE6;border-radius:10px;outline:none;'
        : 'flex:1;min-width:240px;padding:12px 14px;font-family:Archivo,sans-serif;font-size:15px;font-weight:600;color:#16263F;background:#FFFFFF;border:2px solid #D3DCE6;border-radius:10px;outline:none;',
      painelLinhaFiltroStyle: S.modo === 'celular'
        ? 'display:flex;align-items:center;justify-content:space-between;gap:10px;'
        : 'display:contents;',
      painelMostrarTotais: false,
      painelSubtitulo: `${S.pEsts.length} estaleiros · leitura direta do banco`,
      painelMetricas: metricas,
      painelBusca: S.pBusca,
      onPainelBusca: (ev) => this.setState({ pBusca: ev.target.value }),
      painelSoPendentes: S.pSoPendentes,
      onPainelSoPendentes: (ev) => this.setState({ pSoPendentes: ev.target.checked }),
      painelAlternarLabel: Object.values(S.pAbertos).some(Boolean) ? 'Recolher tudo' : 'Expandir tudo',
      painelAlternarTudo: () => {
        if (Object.values(this.state.pAbertos).some(Boolean)) { this.setState({ pAbertos: {} }); return; }
        const t = {};
        this.state.pEsts.forEach((e) => { t[e.numero] = true; });
        this.setState({ pAbertos: t });
      },
      painelResultado: `${visiveis} de ${itens.length} materiais · ${nPend} com pendência`,
      painelSemResultado: S.pStatus === 'ok' && linhas.length === 0,
      painelTemVazios: vazios.length > 0,
      painelVazios: vazios.join(' · '),
      painelEstaleiros: linhas.map((l) => {
        const e = l.est;
        const pc = l.todos.reduce((s, i) => s + (num(i.total_pecas) || 0), 0);
        const mt = l.todos.reduce((s, i) => s + (num(i.total_mt) || 0), 0);
        const kg = l.todos.reduce((s, i) => s + (num(i.total_kg) || 0), 0);
        const semPeso = l.todos.some((i) => num(i.total_kg) == null);
        const nP = l.todos.filter(pend).length;
        const aberto = !!S.pAbertos[e.numero];
        const cel = S.modo === 'celular';
        return {
          numero: dois(e.numero),
          titulo: e.localizacao || `Estaleiro ${dois(e.numero)}`,
          resumoItens: cel
            ? (l.todos.length === 1 ? '1 material' : l.todos.length + ' materiais')
            : l.todos.map((i) => i.codigo || i.descricao || 'sem código').join(' · '),
          pecas: fmt(pc, 0),
          metros: fmt(mt, 1),
          quilos: kg > 0 ? fmt(Math.round(kg), 0) + (semPeso ? '+' : '') : '—',
          kgStyle: `font-size:17px;font-weight:800;font-variant-numeric:tabular-nums;color:${semPeso ? '#8A4B0B' : '#16263F'};`,
          temPendencia: nP > 0,
          pendLabel: nP + (nP === 1 ? ' PENDÊNCIA' : ' PENDÊNCIAS'),
          aberto,
          cabecalhoStyle: cel
            ? 'display:flex;flex-direction:column;align-items:stretch;gap:11px;padding:12px 13px;'
            : 'display:flex;align-items:center;gap:14px;padding:12px 16px;',
          acoesStyle: cel
            ? 'display:flex;flex-direction:column;align-items:stretch;gap:9px;'
            : 'display:flex;align-items:center;gap:20px;flex:none;',
          btnQRStyle: `padding:9px 13px;font-family:Archivo,sans-serif;font-size:12px;font-weight:800;color:#FFFFFF;background:#E4622A;border:none;border-radius:8px;cursor:pointer;white-space:nowrap;${cel ? 'width:100%;min-height:40px;' : 'flex:none;'}`,
          abertoCelular: aberto && S.modo === 'celular',
          abertoDesktop: aberto && S.modo !== 'celular',
          toggle: () => this.setState((s) => ({
            pAbertos: s.pAbertos[e.numero] ? {} : { [e.numero]: true },
          })),
          chevronStyle: `font-size:14px;color:#7E93AE;line-height:1;cursor:pointer;transition:transform .18s;transform:rotate(${aberto ? '180deg' : '0deg'});`,
          verComoQR: () => {
            if (Number(this.state.estNum) === Number(e.numero) && this.state.status === 'ok') {
              this.setState({ tela: 'qr' });
              return;
            }
            this.setState({ tela: 'qr', estNum: e.numero }, () => this.carregar());
          },
          itens: l.itens.slice().sort((a, b) => {
            const na = S.pNumeros[e.id + '|' + a.produto_id];
            const nb = S.pNumeros[e.id + '|' + b.produto_id];
            return (na == null ? 1e9 : na) - (nb == null ? 1e9 : nb);
          }).map((i) => {
            const p = S.pProdutos[i.produto_id] || {};
            const semDesc = !!i.pend_sem_descricao;
            const semCod = !!i.pend_sem_codigo || !i.codigo;
            const semPesoI = !!i.pend_sem_peso || num(i.total_kg) == null;
            const faltas = [];
            if (semDesc) faltas.push('DESCRIÇÃO');
            if (semCod) faltas.push('CÓDIGO');
            if (semPesoI) faltas.push('PESO');
            const kgm = num(i.kg_por_metro) ?? num(p.kg_por_metro);
            const pKg = num(p.preco_kg), pMt = num(p.preco_mt), pUn = num(p.preco_un);
            const n = S.pNumeros[e.id + '|' + i.produto_id];
            return {
              numPintado: n == null ? '—' : String(n),
              desc: semDesc ? (i.codigo || 'MATERIAL NÃO IDENTIFICADO') : i.descricao,
              descStyle: `font-size:14px;font-weight:700;line-height:1.3;color:${semDesc ? '#8A4B0B' : '#16263F'};`,
              codigo: semCod ? 'SEM CÓDIGO' : i.codigo,
              codStyle: `font-size:13px;font-weight:700;letter-spacing:0.06em;color:${semCod ? '#A5763C' : '#4A6280'};`,
              kgm: fmt(kgm, 3),
              lotes: fmt(num(i.lotes), 0),
              pecas: fmt(num(i.total_pecas), 0),
              metros: fmt(num(i.total_mt), 2),
              precoKg: brl(pKg),
              precoMt: brl(pMt),
              precoUn: brl(pUn),
              precoStyle: 'font-size:13px;font-weight:700;color:#16263F;text-align:right;font-variant-numeric:tabular-nums;',
              pendente: faltas.length > 0,
              pendLabel: 'FALTA ' + faltas.join(' · '),
              precoInconsistente: this.checarPreco(pKg, pMt, kgm).ruim,
              rowStyle: `display:grid;grid-template-columns:52px 1fr 108px 84px 66px 78px 90px 96px 96px 96px;gap:8px;align-items:center;padding:9px 16px;background:#FFFFFF;border-bottom:1px solid #EDF1F5;`,
            };
          }),
        };
      }),
    };
  }

  adminVals() {
    const S = this.state;
    const prods = this.cache.produtos || [];
    const ests = this.cache.estaleiros || [];
    const inputBase = 'width:100%;padding:9px 11px;font-family:Archivo,sans-serif;font-size:14px;font-weight:700;color:#16263F;background:#F6F8FB;border:1px solid #D3DCE6;border-radius:7px;outline:none;';
    const ABAS = [
      { id: 'estoque', nome: 'Estoque' }, { id: 'materiais', nome: 'Materiais' },
      { id: 'precos', nome: 'Preços' },
      { id: 'pendencias', nome: 'Pendências' }, { id: 'relatorios', nome: 'Relatórios' },
      { id: 'contas', nome: 'Contas' }, { id: 'qr', nome: 'QR e placas' },
    ];
    const abaStyle = (on) => `padding:9px 16px;font-family:Archivo,sans-serif;font-size:13px;font-weight:700;border-radius:9px;cursor:pointer;white-space:nowrap;border:1px solid ${on ? '#E4622A' : '#D3DCE6'};background:${on ? '#E4622A' : '#FFFFFF'};color:${on ? '#FFFFFF' : '#4A6280'};`;

    const pendItem = (i) => !!i.pend_sem_descricao || !!i.pend_sem_codigo ||
      !!i.pend_sem_peso || num(i.total_kg) == null;
    const porEstAdm = new Map();
    (S.pItens || []).forEach((i) => {
      if (!porEstAdm.has(i.estaleiro)) porEstAdm.set(i.estaleiro, []);
      porEstAdm.get(i.estaleiro).push(i);
    });
    const geralCards = (S.pEsts || []).filter((e) => {
      if (!S.eSoPendentes) return true;
      return (porEstAdm.get(e.numero) || []).some(pendItem);
    }).map((e) => {
      const its = porEstAdm.get(e.numero) || [];
      const soma = (c) => its.reduce((s, i) => s + (num(i[c]) || 0), 0);
      const nPend = its.filter(pendItem).length;
      return {
        numero: dois(e.numero),
        titulo: e.localizacao ? `Estaleiro ${dois(e.numero)} · ${e.localizacao}` : `Estaleiro ${dois(e.numero)}`,
        resumo: its.length ? `${its.length} material(is) cadastrado(s)` : 'Sem lotes registrados',
        pecas: fmt(soma('total_pecas'), 0),
        metros: fmt(soma('total_mt'), 2),
        quilos: fmt(soma('total_kg'), 1),
        temPendencia: nPend > 0,
        pendLabel: nPend + ' PENDÊNCIA' + (nPend > 1 ? 'S' : ''),
        abrir: () => this.setState({ eEstNum: e.numero, eStatus: 'idle' }, () => this.carregarEstoque()),
      };
    });
    const emGeral = S.eEstNum == null;
    const itensTodos = S.pItens || [];
    const somaTudo = (c) => itensTodos.reduce((s, i) => s + (num(i[c]) || 0), 0);
    const nPendTudo = itensTodos.filter(pendItem).length;
    const comPreco = prods.filter((p) =>
      num(p.preco_kg) != null || num(p.preco_mt) != null || num(p.preco_un) != null).length;
    const geralMetricas = [
      { r: 'ESTALEIROS', v: fmt((S.pEsts || []).length, 0) },
      { r: 'MATERIAIS', v: fmt(itensTodos.length, 0) },
      { r: 'PEÇAS', v: fmt(somaTudo('total_pecas'), 0) },
      { r: 'METROS', v: fmt(somaTudo('total_mt'), 2) },
      { r: 'QUILOS', v: fmt(somaTudo('total_kg'), 2) },
      { r: 'COM PENDÊNCIA', v: fmt(nPendTudo, 0), alerta: nPendTudo > 0 },
      { r: 'COM PREÇO', v: `${comPreco} de ${prods.length}`, alerta: comPreco < prods.length },
    ].map((m, i) => ({
      rotulo: m.r, valor: m.v,
      boxStyle: `padding:14px 18px;border-left:${i ? '1px solid #E4EAF1' : 'none'};`,
      valorStyle: `font-size:23px;font-weight:800;margin-top:4px;font-variant-numeric:tabular-nums;color:${m.alerta ? '#8A4B0B' : '#16263F'};`,
    }));

    const estoqueLotes = (S.eLotes || []).slice().sort((a, b) => {
      const na = S.eNumeros[a.produto_id], nb = S.eNumeros[b.produto_id];
      const d = (na == null ? 1e9 : na) - (nb == null ? 1e9 : nb);
      return d !== 0 ? d : (num(b.tamanho_m) || 0) - (num(a.tamanho_m) || 0);
    }).map((l, i) => {
      const p = prods.find((x) => x.id === l.produto_id) || {};
      const qtd = num(l.quantidade) || 0;
      const pp = num(l.peso_peca_kg);
      const semDesc = !p.descricao;
      const n = S.eNumeros[l.produto_id];
      return {
        numPintado: n == null ? '—' : String(n),
        desc: semDesc ? (p.codigo || 'MATERIAL NÃO IDENTIFICADO') : p.descricao,
        descStyle: `font-size:14px;font-weight:700;color:${semDesc ? '#8A4B0B' : '#16263F'};`,
        codigo: p.codigo || 'SEM CÓDIGO',
        codStyle: `font-size:13px;font-weight:700;letter-spacing:0.06em;color:${p.codigo ? '#4A6280' : '#A5763C'};`,
        tamanho: fmt(num(l.tamanho_m), 2) + ' m',
        qtd: fmt(qtd, 0),
        kgPeca: pp == null ? '—' : fmt(pp, 2),
        kgTotal: pp == null ? '—' : fmt(pp * qtd, 1),
        temObs: !!l.observacao,
        obs: l.observacao || '',
        rowStyle: `display:grid;grid-template-columns:56px 1fr 110px 96px 72px 104px 110px 150px;gap:8px;align-items:center;padding:9px 16px;background:${i % 2 ? '#F7F9FB' : '#FFFFFF'};border-bottom:1px solid #EDF1F5;`,
        editar: () => this.abrirLote(l),
        excluir: () => this.setState({
          confirmId: l.id, confirmTipo: 'lote', confirmProduto: l.produto_id,
          confirmTitulo: 'Excluir este lote?',
          confirmTexto: `${qtd} peça(s) de ${fmt(num(l.tamanho_m), 2)} m — ${p.descricao || p.codigo || 'material'}. O histórico da exclusão fica registrado.`,
        }),
      };
    });
    const totalPecasEst = (S.eLotes || []).reduce((s, l) => s + (num(l.quantidade) || 0), 0);

    const q1 = semAcento(S.precosBusca).trim();
    const semPreco = (p) => num(p.preco_kg) == null && num(p.preco_mt) == null && num(p.preco_un) == null;
    const precosFiltrados = prods.filter((p) => {
      if (S.precosSoVazios && !semPreco(p)) return false;
      if (!q1) return true;
      return semAcento(p.codigo).includes(q1) || semAcento(p.descricao).includes(q1);
    });
    const nSemPreco = prods.filter(semPreco).length;
    const campoPreco = (p, chave) => {
      const ed = S.precoEdits[p.id] || {};
      if (ed[chave] !== undefined) return ed[chave];
      const v = num(p['preco_' + chave]);
      return v == null ? '' : fmt(v, 2);
    };
    const editarPreco = (id, chave, valor) => this.setState((s) => ({
      precoEdits: { ...s.precoEdits, [id]: { ...(s.precoEdits[id] || {}), [chave]: valor } },
    }));
    const paraNumero = (txt) => {
      const t = String(txt || '').replace(/[R$\s]/gi, '').trim();
      if (!t) return null;
      const v = Number(t.replace(/\./g, '').replace(',', '.'));
      return Number.isFinite(v) && v > 0 ? v : null;
    };

    const usoPorProduto = {};
    (S.pItens || []).forEach((i) => {
      usoPorProduto[i.produto_id] = (usoPorProduto[i.produto_id] || 0) + 1;
    });
    const qm = semAcento(S.matBusca).trim();
    const matFiltrados = prods.filter((p) => !qm ||
      semAcento(p.codigo).includes(qm) || semAcento(p.descricao).includes(qm));
    const nInativos = prods.filter((p) => p.ativo === false).length;
    const matResumo = `${prods.length} materiais cadastrados` +
      (nInativos ? ` · ${nInativos} inativo(s)` : '');

    const pendentes = prods.filter((p) => !p.codigo || !p.descricao || num(p.kg_por_metro) == null);
    const campoPend = (p, chave, atual) => {
      const ed = S.pendEdits[p.id] || {};
      return ed[chave] !== undefined ? ed[chave] : (atual == null ? '' : String(atual));
    };
    const editarPend = (id, chave, valor) => this.setState((s) => ({
      pendEdits: { ...s.pendEdits, [id]: { ...(s.pendEdits[id] || {}), [chave]: valor } },
    }));

    const REL = {
      movimentos: {
        nome: 'Entrada e saída',
        cols: ['Quando', 'Tipo', 'Estaleiro', 'Material', 'Peças', 'Metros', 'Quilos', 'Autor'],
        larguras: '150px 110px 90px 1fr 78px 90px 96px 150px',
        celulas: (r) => [
          { t: quandoTxt(r.em) }, { t: tipoTxt(r) }, { t: r.estaleiro == null ? '—' : dois(r.estaleiro) },
          { t: r.material || r.descricao || r.codigo || '—' },
          { t: fmt(num(r.delta_pecas), 0), n: true }, { t: fmt(num(r.delta_mt), 2), n: true },
          { t: fmt(num(r.delta_kg), 1), n: true }, { t: autorTxt(r) },
        ],
      },
      precos: {
        nome: 'Alterações de preço',
        cols: ['Quando', 'Material', 'Campo', 'De', 'Para', 'Autor'],
        larguras: '150px 1fr 100px 120px 120px 150px',
        celulas: (r) => [
          { t: quandoTxt(r.em) }, { t: r.material || r.descricao || r.codigo || '—' },
          { t: (r.campo || '').replace('preco_', 'R$/').toUpperCase() },
          { t: brl(num(r.valor_antes)), n: true }, { t: brl(num(r.valor_depois)), n: true },
          { t: autorTxt(r) },
        ],
      },
      auditoria: {
        nome: 'Trilha completa',
        cols: ['Quando', 'Tabela', 'Operação', 'Registro', 'Autor'],
        larguras: '150px 160px 120px 1fr 150px',
        celulas: (r) => [
          { t: quandoTxt(r.em) }, { t: r.tabela || '—' }, { t: (r.operacao || '').toUpperCase() },
          { t: r.resumo || r.registro || r.material || '—' }, { t: autorTxt(r) },
        ],
      },
      usuarios: {
        nome: 'Resumo por usuário',
        cols: ['Usuário', 'E-mail', 'Alterações', 'Última em'],
        larguras: '1fr 1fr 120px 170px',
        celulas: (r) => [
          { t: r.nome || '—' }, { t: r.email || '—' },
          { t: fmt(num(r.alteracoes ?? r.total), 0), n: true }, { t: quandoTxt(r.ultima_em || r.em) },
        ],
      },
    };
    const relCfg = REL[S.relAba] || REL.movimentos;
    const relRows = S.relRows || [];
    const somaMovs = (campo) => relRows.reduce((s, r) => s + (num(r[campo]) || 0), 0);
    const entradas = relRows.filter((r) => (num(r.delta_pecas) || 0) > 0).length;
    const saidas = relRows.filter((r) => (num(r.delta_pecas) || 0) < 0).length;

    const vazFiltrados = (S.vazRows || []).filter((r) =>
      S.eEstNum == null || Number(r.estaleiro) === Number(S.eEstNum));

    const meuId = this.sessao && this.sessao.user ? this.sessao.user.id : null;
    const tag = (txt, cor, fundo) => `display:inline-block;padding:4px 9px;border-radius:5px;font-size:11px;font-weight:800;letter-spacing:0.08em;color:${cor};background:${fundo};`;

    const contagem = {};
    (S.pItens || []).forEach((i) => { contagem[i.estaleiro] = (contagem[i.estaleiro] || 0) + 1; });

    return {
      adminAbas: ABAS.map((a) => ({
        nome: a.nome, style: abaStyle(S.aAba === a.id), ir: () => this.irAba(a.id),
      })),
      adminMsg: !!S.aMsg,
      adminMsgTexto: S.aMsg,
      adminMsgStyle: `padding:12px 15px;border-radius:9px;margin-bottom:14px;font-size:13px;font-weight:700;line-height:1.45;${S.aMsgTipo === 'erro' ? 'background:#FDECEA;border-left:3px solid #C4321F;color:#8E2416;' : S.aMsgTipo === 'atencao' ? 'background:#FCEFD9;border-left:3px solid #E4622A;color:#8A4B0B;' : 'background:#E6F4EC;border-left:3px solid #1E7A46;color:#12643A;'}`,
      abaEstoque: S.aAba === 'estoque',
      vaziosVisivel: S.vazStatus === 'ok' && vazFiltrados.length > 0,
      vaziosTitulo: S.eEstNum == null ? 'ITENS SEM MATERIAL' : `ITENS SEM MATERIAL · ESTALEIRO ${dois(S.eEstNum)}`,
      vaziosResumo: `${vazFiltrados.length} número(s) reservado(s) sem lote no pátio`,
      vazios: vazFiltrados.map((r, i) => {
        const dias = Number(r.dias_vazio) || 0;
        const chave = String(r.estaleiro) + '|' + String(r.codigo);
        const velho = dias >= 30;
        return {
          est: dois(r.estaleiro),
          numero: dois(r.n_pintado),
          desc: r.descricao || '—',
          codigo: r.codigo || '—',
          desde: dataBr(r.vazio_desde) || '—',
          dias: fmt(dias, 0) + (dias === 1 ? ' dia' : ' dias'),
          diasStyle: `font-size:13px;font-weight:800;text-align:right;font-variant-numeric:tabular-nums;color:${velho ? '#8A4B0B' : '#4A6280'};`,
          encerrar: () => this.encerrarItem(r),
          btnLabel: S.vazEncerrando === chave ? 'Encerrando…' : 'Encerrar item',
          btnStyle: 'padding:6px 11px;font-family:Archivo,sans-serif;font-size:12px;font-weight:700;color:#16263F;background:#FFFFFF;border:1px solid #D3DCE6;border-radius:7px;cursor:pointer;',
          rowStyle: `display:grid;grid-template-columns:82px 56px 1fr 110px 110px 96px 140px;gap:8px;align-items:center;padding:9px 16px;background:${i % 2 ? '#F7F9FB' : '#FFFFFF'};border-bottom:1px solid #EDF1F6;`,
        };
      }),
      abaMateriais: S.aAba === 'materiais',
      abaPrecos: S.aAba === 'precos',
      abaPendencias: S.aAba === 'pendencias',
      abaRelatorios: S.aAba === 'relatorios',
      abaContas: S.aAba === 'contas',
      abaQR: S.aAba === 'qr',
      opcoesEstoque: [{ valor: '', rotulo: 'Todos os estaleiros' }].concat(
        ests.map((e) => ({
          valor: String(e.numero),
          rotulo: e.localizacao ? `${dois(e.numero)} · ${e.localizacao}` : `Estaleiro ${dois(e.numero)}`,
        }))),
      estoqueEstSel: emGeral ? '' : String(S.eEstNum),
      onEstoqueEst: (ev) => {
        const v = ev.target.value;
        if (!v) { this.setState({ eEstNum: null, eLotes: [], eStatus: 'idle' }); return; }
        this.setState({ eEstNum: parseInt(v, 10), eStatus: 'idle' }, () => this.carregarEstoque());
      },
      estoqueGeral: emGeral,
      geralMetricas,
      geralSubtitulo: `${(S.pEsts || []).length} estaleiros · leitura direta do banco`,
      geralSoPendentes: S.eSoPendentes,
      onGeralSoPendentes: (ev) => this.setState({ eSoPendentes: ev.target.checked }),
      estoqueDetalhe: !emGeral,
      geralCarregando: S.pStatus === 'loading' || S.pStatus === 'idle',
      geralOk: S.pStatus === 'ok',
      geralCards,
      novoProduto: () => this.abrirProduto(null),
      novoLote: () => this.abrirLote(null),
      estoqueCarregando: !emGeral && (S.eStatus === 'loading' || S.eStatus === 'idle'),
      estoqueOk: !emGeral && S.eStatus === 'ok',
      estoqueVazio: !emGeral && S.eStatus === 'ok' && estoqueLotes.length === 0,
      estoqueLotes,
      estoqueResumo: emGeral
        ? `${(S.pEsts || []).length} estaleiros · ${(this.cache.produtos || []).length} materiais`
        : `${estoqueLotes.length} lote(s) · ${fmt(totalPecasEst, 0)} peças`,
      produtoAberto: S.produtoAberto,
      prodTitulo: S.prodId ? 'Editar material' : 'Novo material',
      prodMostrarDescarga: !S.prodId,
      prodDescarregar: S.prodDescarregar,
      onProdDescarregar: (ev) => this.setState({ prodDescarregar: ev.target.checked }),
      prodEstOpcoes: ests.map((e) => ({
        valor: String(e.numero),
        rotulo: e.localizacao ? `${dois(e.numero)} · ${e.localizacao}` : `Estaleiro ${dois(e.numero)}`,
      })),
      prodEst: S.prodEst, prodQtd: S.prodQtd, prodTam: S.prodTam, prodPeso: S.prodPeso,
      onProdEst: (ev) => this.setState({ prodEst: ev.target.value }),
      onProdQtd: (ev) => this.setState({ prodQtd: ev.target.value }),
      onProdTam: (ev) => this.setState({ prodTam: ev.target.value }),
      onProdPeso: (ev) => this.setState({ prodPeso: ev.target.value }),
      matBusca: S.matBusca,
      onMatBusca: (ev) => this.setState({ matBusca: ev.target.value }),
      matResumo: matResumo,
      matVazio: matFiltrados.length === 0,
      matLinhas: matFiltrados.map((p, i) => {
        const ativo = p.ativo !== false;
        const usados = usoPorProduto[p.id] || 0;
        return {
          codigo: p.codigo || 'SEM CÓDIGO',
          codStyle: `font-size:13px;font-weight:800;letter-spacing:0.06em;color:${p.codigo ? '#16263F' : '#A5763C'};`,
          desc: p.descricao || 'MATERIAL NÃO IDENTIFICADO',
          descStyle: `font-size:14px;font-weight:700;color:${p.descricao ? '#16263F' : '#8A4B0B'};`,
          usoLabel: usados === 0 ? 'sem lotes no pátio'
            : usados === 1 ? 'em 1 estaleiro' : `em ${usados} estaleiros`,
          kgm: fmt(num(p.kg_por_metro), 3),
          pKg: brl(num(p.preco_kg)), pMt: brl(num(p.preco_mt)), pUn: brl(num(p.preco_un)),
          precoStyle: 'font-size:13px;font-weight:700;color:#16263F;text-align:right;font-variant-numeric:tabular-nums;',
          ativoLabel: ativo ? 'ATIVO' : 'INATIVO',
          ativoStyle: ativo ? tag('', '#12643A', '#E6F4EC') : tag('', '#8E2416', '#FDECEA'),
          btnAtivoLabel: ativo ? 'Inativar' : 'Ativar',
          btnAtivoStyle: `padding:6px 11px;font-family:Archivo,sans-serif;font-size:12px;font-weight:700;border-radius:7px;cursor:pointer;background:#FFFFFF;border:1px solid ${ativo ? '#8E2416' : '#12643A'};color:${ativo ? '#8E2416' : '#12643A'};`,
          editar: () => this.abrirProduto(p),
          alternarAtivo: () => this.alternarAtivoProduto(p),
          excluir: () => this.setState({
            confirmId: p.id, confirmTipo: 'produto',
            confirmTitulo: 'Excluir este material?',
            confirmTexto: `${p.codigo || 'sem código'} · ${p.descricao || 'material não identificado'}. ` +
              (usados ? `Ele tem lotes em ${usados} estaleiro(s) — o banco vai recusar a exclusão. Inative em vez disso.` : 'Ele não tem lotes no pátio.'),
          }),
          rowStyle: `display:grid;grid-template-columns:110px 1fr 80px 96px 96px 96px 92px 226px;gap:8px;align-items:center;padding:9px 16px;background:${i % 2 ? '#F7F9FB' : '#FFFFFF'};border-bottom:1px solid #EDF1F5;opacity:${ativo ? '1' : '0.6'};`,
        };
      }),
      fecharProduto: () => this.setState({ produtoAberto: false }),
      prodCodigo: S.prodCodigo, prodDesc: S.prodDesc, prodKgm: S.prodKgm,
      prodPKg: S.prodPKg, prodPMt: S.prodPMt, prodPUn: S.prodPUn,
      onProdCodigo: (ev) => this.setState({ prodCodigo: ev.target.value }),
      onProdDesc: (ev) => this.setState({ prodDesc: ev.target.value }),
      onProdKgm: (ev) => this.setState({ prodKgm: ev.target.value }),
      onProdPKg: (ev) => this.setState({ prodPKg: ev.target.value }),
      onProdPMt: (ev) => this.setState({ prodPMt: ev.target.value }),
      onProdPUn: (ev) => this.setState({ prodPUn: ev.target.value }),
      prodErro: !!S.prodErro, prodErroTexto: S.prodErro,
      prodSalvando: S.prodSalvando,
      prodSalvarLabel: S.prodSalvando ? 'Gravando…' : 'Cadastrar material',
      prodSalvarStyle: `width:100%;padding:13px;font-family:Archivo,sans-serif;font-size:15px;font-weight:800;color:#FFFFFF;background:${S.prodSalvando ? '#B4B9C2' : '#E4622A'};border:none;border-radius:9px;cursor:${S.prodSalvando ? 'default' : 'pointer'};`,
      salvarProdutoNovo: () => this.salvarProdutoNovo(),
      precosBusca: S.precosBusca,
      onPrecosBusca: (ev) => this.setState({ precosBusca: ev.target.value }),
      precosSoVazios: S.precosSoVazios,
      onPrecosSoVazios: (ev) => this.setState({ precosSoVazios: ev.target.checked }),
      precosPendentes: nSemPreco === 0
        ? `Todos os ${prods.length} materiais com preço`
        : `${nSemPreco} de ${prods.length} materiais ainda sem preço`,
      precosLinhas: precosFiltrados.map((p, i) => {
        const kgm = num(p.kg_por_metro);
        const chk = this.checarPreco(num(p.preco_kg), num(p.preco_mt), kgm);
        return {
          codigo: p.codigo || 'SEM CÓDIGO',
          codStyle: `font-size:13px;font-weight:800;letter-spacing:0.06em;color:${p.codigo ? '#16263F' : '#A5763C'};`,
          desc: p.descricao || 'MATERIAL NÃO IDENTIFICADO',
          descStyle: `font-size:14px;font-weight:700;color:${p.descricao ? '#16263F' : '#8A4B0B'};`,
          kgm: fmt(kgm, 3),
          incoerente: chk.ruim,
          vKg: campoPreco(p, 'kg'), vMt: campoPreco(p, 'mt'), vUn: campoPreco(p, 'un'),
          onKg: (ev) => editarPreco(p.id, 'kg', ev.target.value),
          onMt: (ev) => editarPreco(p.id, 'mt', ev.target.value),
          onUn: (ev) => editarPreco(p.id, 'un', ev.target.value),
          salvar: () => {
            const ed = this.state.precoEdits[p.id];
            if (!ed) return;
            const campos = {};
            ['kg', 'mt', 'un'].forEach((k) => {
              if (ed[k] === undefined) return;
              const v = paraNumero(ed[k]);
              if (v !== num(p['preco_' + k])) campos['preco_' + k] = v;
            });
            if (!Object.keys(campos).length) return;
            campos.preco_data = new Date().toISOString().slice(0, 10);
            this.setState((s) => {
              const e = { ...s.precoEdits }; delete e[p.id]; return { precoEdits: e };
            });
            this.salvarProduto(p.id, campos, 'Preço');
          },
          inputStyle: inputBase + 'text-align:right;font-variant-numeric:tabular-nums;',
          dataLabel: p.preco_data ? dataBr(p.preco_data) : '—',
          dataStyle: `font-size:12px;font-weight:600;color:#7E93AE;text-align:right;`,
          rowStyle: `display:grid;grid-template-columns:108px 1fr 84px 130px 130px 130px 110px;gap:8px;align-items:center;padding:8px 16px;background:${i % 2 ? '#F7F9FB' : '#FFFFFF'};border-bottom:1px solid #EDF1F5;`,
        };
      }),
      pendResumo: pendentes.length === 0
        ? 'Nenhuma pendência de cadastro'
        : `${pendentes.length} material(is) com cadastro incompleto`,
      pendVazio: pendentes.length === 0,
      pendLinhas: pendentes.map((p, i) => {
        const faltas = [];
        if (!p.codigo) faltas.push('CÓDIGO');
        if (!p.descricao) faltas.push('DESCRIÇÃO');
        if (num(p.kg_por_metro) == null) faltas.push('PESO');
        return {
          vCod: campoPend(p, 'codigo', p.codigo),
          vDesc: campoPend(p, 'descricao', p.descricao),
          vKgm: campoPend(p, 'kg_por_metro', p.kg_por_metro == null ? '' : String(p.kg_por_metro).replace('.', ',')),
          onCod: (ev) => editarPend(p.id, 'codigo', ev.target.value),
          onDesc: (ev) => editarPend(p.id, 'descricao', ev.target.value),
          onKgm: (ev) => editarPend(p.id, 'kg_por_metro', ev.target.value),
          salvar: () => {
            const ed = this.state.pendEdits[p.id];
            if (!ed) return;
            const campos = {};
            if (ed.codigo !== undefined && ed.codigo.trim() !== (p.codigo || '')) {
              campos.codigo = ed.codigo.trim() || null;
            }
            if (ed.descricao !== undefined && ed.descricao.trim() !== (p.descricao || '')) {
              campos.descricao = ed.descricao.trim() || null;
            }
            if (ed.kg_por_metro !== undefined) {
              const v = paraNumero(ed.kg_por_metro);
              if (v !== num(p.kg_por_metro)) campos.kg_por_metro = v;
            }
            if (!Object.keys(campos).length) return;
            this.setState((s) => {
              const e = { ...s.pendEdits }; delete e[p.id]; return { pendEdits: e };
            });
            this.salvarProduto(p.id, campos, 'Cadastro');
          },
          falta: 'FALTA ' + faltas.join(' · '),
          inputStyle: inputBase,
          inputNumStyle: inputBase + 'text-align:right;font-variant-numeric:tabular-nums;',
          rowStyle: `display:grid;grid-template-columns:130px 1fr 130px 200px;gap:10px;align-items:center;padding:8px 16px;background:${i % 2 ? '#F7F9FB' : '#FFFFFF'};border-bottom:1px solid #EDF1F5;`,
        };
      }),
      relAbas: Object.keys(REL).map((k) => ({
        nome: REL[k].nome, style: abaStyle(S.relAba === k),
        ir: () => this.setState({ relAba: k }, () => this.carregarRelatorio()),
      })),
      relDe: S.relDe, relAte: S.relAte,
      onRelDe: (ev) => this.setState({ relDe: ev.target.value }),
      onRelAte: (ev) => this.setState({ relAte: ev.target.value }),
      aplicarPeriodo: () => this.carregarRelatorio(),
      limparPeriodo: () => this.setState({ relDe: '', relAte: '' }, () => this.carregarRelatorio()),
      relCarregando: S.relStatus === 'loading' || S.relStatus === 'idle',
      relOk: S.relStatus === 'ok',
      relVazio: S.relStatus === 'ok' && relRows.length === 0,
      relMovimentosVisivel: S.relAba === 'movimentos' && S.relStatus === 'ok' && relRows.length > 0,
      relTotais: [
        { r: 'REGISTROS', v: fmt(relRows.length, 0) },
        { r: 'ENTRADAS', v: fmt(entradas, 0) },
        { r: 'SAÍDAS', v: fmt(saidas, 0) },
        { r: 'PEÇAS (LÍQUIDO)', v: fmt(somaMovs('delta_pecas'), 0) },
        { r: 'QUILOS (LÍQUIDO)', v: fmt(somaMovs('delta_kg'), 1) },
      ].map((m) => ({
        rotulo: m.r, valor: m.v,
        valorStyle: 'font-size:22px;font-weight:800;color:#16263F;margin-top:4px;font-variant-numeric:tabular-nums;',
      })),
      relHeadStyle: `display:grid;grid-template-columns:${relCfg.larguras};gap:10px;padding:10px 16px;background:#F1F4F8;font-size:9px;font-weight:800;letter-spacing:0.08em;color:#4A6280;`,
      relColunas: relCfg.cols.map((c, i) => ({
        nome: c,
        style: i >= 4 && S.relAba !== 'auditoria' ? 'text-align:right;' : '',
      })),
      relLinhas: relRows.map((r, i) => ({
        rowStyle: `display:grid;grid-template-columns:${relCfg.larguras};gap:10px;align-items:center;padding:9px 16px;background:${i % 2 ? '#F7F9FB' : '#FFFFFF'};border-bottom:1px solid #EDF1F5;`,
        celulas: relCfg.celulas(r).map((c) => ({
          texto: c.t,
          style: `font-size:13px;font-weight:${c.n ? '700' : '600'};color:#16263F;${c.n ? 'text-align:right;font-variant-numeric:tabular-nums;' : ''}`,
        })),
      })),
      contaInputStyle: inputBase + 'padding:11px 12px;',
      novoNome: S.novoNome, novoEmail: S.novoEmail, novaSenha: S.novaSenha, novoPapel: S.novoPapel,
      onNovoNome: (ev) => this.setState({ novoNome: ev.target.value }),
      onNovoEmail: (ev) => this.setState({ novoEmail: ev.target.value }),
      onNovaSenha: (ev) => this.setState({ novaSenha: ev.target.value }),
      onNovoPapel: (ev) => this.setState({ novoPapel: ev.target.value }),
      criarConta: () => this.criarConta(),
      contasCarregando: S.contasStatus === 'loading' || S.contasStatus === 'idle',
      contasOk: S.contasStatus === 'ok',
      contasErro: S.contasStatus === 'erro',
      contasErroTexto: S.contasErro,
      contas: (S.contas || []).map((c, i) => {
        const uid = c.user_id || c.id;
        const ehVoce = uid === meuId;
        const admin = c.papel === 'admin';
        const ativo = c.ativo !== false;
        const btn = (cor) => `padding:6px 10px;font-family:Archivo,sans-serif;font-size:12px;font-weight:700;border-radius:7px;cursor:${ehVoce ? 'not-allowed' : 'pointer'};opacity:${ehVoce ? '0.45' : '1'};border:1px solid ${cor};background:#FFFFFF;color:${cor};`;
        return {
          nome: c.nome || '—',
          email: c.email || '—',
          papelLabel: admin ? 'ADMIN' : 'VENDEDOR',
          papelStyle: admin ? tag('', '#12643A', '#E6F4EC') : tag('', '#4A6280', '#F1F4F8'),
          ativoLabel: ativo ? 'ATIVO' : 'INATIVO',
          ativoStyle: ativo ? tag('', '#12643A', '#E6F4EC') : tag('', '#8E2416', '#FDECEA'),
          ehVoce,
          btnPapelLabel: admin ? 'Tornar vendedor' : 'Tornar admin',
          btnPapelStyle: btn('#16263F'),
          alternarPapel: () => { if (!ehVoce) this.atualizarConta(uid, { papel: admin ? 'vendedor' : 'admin' }, 'Papel alterado.'); },
          btnAtivoLabel: ativo ? 'Desativar' : 'Ativar',
          btnAtivoStyle: btn(ativo ? '#8E2416' : '#12643A'),
          alternarAtivo: () => { if (!ehVoce) this.atualizarConta(uid, { ativo: !ativo }, ativo ? 'Conta desativada.' : 'Conta ativada.'); },
          trocarSenha: () => this.novaSenhaConta(uid, c.email),
          rowStyle: `display:grid;grid-template-columns:1fr 1fr 130px 110px 220px;gap:10px;align-items:center;padding:10px 16px;background:${i % 2 ? '#F7F9FB' : '#FFFFFF'};border-bottom:1px solid #EDF1F5;`,
        };
      }),
      urlBase: S.urlBase,
      onUrlBase: (ev) => this.setState({ urlBase: ev.target.value }),
      imprimirTodas: () => this.imprimirPlacas(ests.map((e) => e.numero)),
      qrCards: ests.map((e) => {
        const url = this.urlDoEstaleiro(e.numero);
        const qtd = contagem[e.numero] || 0;
        return {
          numero: dois(e.numero),
          qtdLabel: qtd === 1 ? '1 material' : qtd + ' materiais',
          url,
          qrRef: (el) => {
            if (!el || el.dataset.url === url) return;
            el.dataset.url = url;
            try { el.innerHTML = window.QRLite.svg(url, { margin: 1 }); } catch (err) { el.innerHTML = ''; }
            const s = el.firstChild;
            if (s && s.style) { s.style.width = '100%'; s.style.height = '100%'; s.style.display = 'block'; }
          },
          copiarLabel: S.qrCopiado === e.numero ? 'Copiado' : 'Copiar',
          copiar: () => {
            try {
              navigator.clipboard.writeText(url);
              this.setState({ qrCopiado: e.numero });
              setTimeout(() => this.setState({ qrCopiado: null }), 1800);
            } catch (err) { this.aviso('Não foi possível copiar.', 'erro'); }
          },
          previa: () => this.setState({ tela: 'qr', estNum: e.numero }, () => this.carregar()),
          imprimir: () => this.imprimirPlacas([e.numero]),
        };
      }),
      loteAberto: S.loteAberto,
      loteTitulo: S.loteId ? 'Editar lote' : 'Adicionar lote',
      fecharLote: () => this.setState({ loteAberto: false }),
      loteProduto: S.loteProduto,
      onLoteProduto: (ev) => this.setState({ loteProduto: ev.target.value }),
      loteProdutos: prods.map((p) => ({
        valor: p.id,
        rotulo: `${p.codigo || 'SEM CÓDIGO'} · ${p.descricao || 'material não identificado'}`,
      })),
      loteQtd: S.loteQtd, loteTam: S.loteTam, lotePeso: S.lotePeso, loteObs: S.loteObs,
      onLoteQtd: (ev) => this.setState({ loteQtd: ev.target.value }),
      onLoteTam: (ev) => this.setState({ loteTam: ev.target.value }),
      onLotePeso: (ev) => this.setState({ lotePeso: ev.target.value }),
      onLoteObs: (ev) => this.setState({ loteObs: ev.target.value }),
      loteErro: !!S.loteErro, loteErroTexto: S.loteErro,
      loteSalvando: S.loteSalvando,
      loteSalvarLabel: S.loteSalvando ? 'Gravando…' : (S.loteId ? 'Salvar alterações' : 'Adicionar lote'),
      loteSalvarStyle: `width:100%;padding:13px;font-family:Archivo,sans-serif;font-size:15px;font-weight:800;color:#FFFFFF;background:${S.loteSalvando ? '#B4B9C2' : '#E4622A'};border:none;border-radius:9px;cursor:${S.loteSalvando ? 'default' : 'pointer'};`,
      salvarLote: () => this.salvarLote(),
      loteInputStyle: inputBase + 'padding:11px 12px;',
      loteSelectStyle: inputBase + 'padding:11px 12px;margin-top:5px;cursor:pointer;',
      confirmAberto: S.confirmId != null,
      confirmTitulo: S.confirmTitulo || 'Excluir este item?',
      confirmTexto: S.confirmTexto || 'Deseja realmente confirmar a exclusão deste item?',
      cancelarExcluir: () => this.setState({ confirmId: null }),
      confirmarExcluir: () => this.excluirLote(),
    };
  }

  abrirEstaleiroHome(numEst) {
    this.setState({ estNum: numEst, tela: 'qr' }, () => {
      if (this.sessao) this.carregar();
    });
  }

  renderVals() {
    const S = this.state;
    const logado = !!S.perfil;
    const ehAdmin = logado && S.perfil.papel === 'admin';
    const naTelaHome = S.tela === 'home';
    const naTelaQR = S.tela === 'qr';
    const TELAS = [
      { id: 'home', nome: 'Página Inicial' },
      ...(S.estNum ? [{ id: 'qr', nome: `Estaleiro ${dois(S.estNum)}` }] : []),
      { id: 'vendedor', nome: 'Painel do Vendedor' },
      { id: 'admin', nome: 'Administração' },
    ];
    const tabStyle = (on) => `padding:6px 13px;font-size:12px;font-weight:700;border-radius:7px;cursor:pointer;white-space:nowrap;border:1px solid ${on ? '#E4622A' : '#24384F'};background:${on ? '#E4622A' : 'transparent'};color:${on ? '#FFFFFF' : '#7C90A8'};`;
    const lista = S.itens || [];
    const somaKg = lista.reduce((s, i) => s + (num(i.total_kg) || 0), 0);
    const somaMt = lista.reduce((s, i) => s + (num(i.total_mt) || 0), 0);
    const somaPc = lista.reduce((s, i) => s + (num(i.total_pecas) || 0), 0);
    const algumSemPeso = lista.some((i) => num(i.total_kg) == null);
    const q = semAcento(S.busca).trim();
    const filtrados = lista.filter((i) => !q ||
      semAcento(i.codigo).includes(q) || semAcento(i.descricao).includes(q))
      .sort((a, b) => {
        const na = S.numeros[a.produto_id], nb = S.numeros[b.produto_id];
        return (na == null ? 1e9 : na) - (nb == null ? 1e9 : nb);
      });
    const sub = [];
    if (lista.length) sub.push(lista.length === 1 ? '1 material' : lista.length + ' materiais');
    if (S.local) sub.push(S.local);
    if (S.perfil) sub.push(S.perfil.nome || S.perfil.email);
    return {
      telas: TELAS.map((t) => ({
        nome: t.nome, style: tabStyle(S.tela === t.id),
        ir: () => this.irTela(t.id),
      })),
      irParaLogin: () => this.setState({ tela: 'qr' }),
      irParaVendedor: () => this.irTela('vendedor'),
      irParaAdmin: () => this.irTela('admin'),
      mostrarHome: naTelaHome,
      homeEstaleiros: (S.estOpcoes.length ? S.estOpcoes : Array.from({ length: 46 }, (_, i) => ({
        numero: i + 1,
        localizacao: i === 0 ? 'Galpão Central' : 'Pátio de Estaleiro',
      }))).map((e) => ({
        numero: dois(e.numero),
        localizacao: e.localizacao || (Number(e.numero) === 1 ? 'Galpão Central' : 'Pátio de Estaleiro'),
        acessar: () => this.abrirEstaleiroHome(e.numero),
      })),
      vistaCelular: S.modo === 'celular',
      vistaDesktop: S.modo !== 'celular',
      loginMolduraStyle: 'width:100%;max-width:400px;margin:0 auto;',
      molduraStyle: 'width:100%;max-width:420px;margin:0 auto;',
      painelMolduraStyle: 'max-width:1180px;width:100%;margin:0 auto;padding:22px 16px 60px;',
      logado,
      usuarioLabel: S.perfil ? `${S.perfil.nome || S.perfil.email} · ${String(S.perfil.papel).toUpperCase()}` : '',
      sair: () => this.encerrarSessao(),
      mostrarLogin: naTelaQR && !logado,
      mostrarQR: naTelaQR && logado,
      mostrarLoginGeral: !naTelaHome && !naTelaQR && !logado,
      mostrarPainel: S.tela === 'vendedor' && logado,
      mostrarAdmin: S.tela === 'admin' && logado && ehAdmin,
      mostrarSemPermissao: S.tela === 'admin' && logado && !ehAdmin,
      entrarAdminTeste: () => {
        this.setState({ email: 'admin@jpatricio.com.br', senha: 'admin' }, () => this.entrar());
      },
      entrarVendedorTeste: () => {
        this.setState({ email: 'vendedor@jpatricio.com.br', senha: 'vendedor' }, () => this.entrar());
      },
      ...this.painelVals(),
      ...this.adminVals(),
      email: S.email,
      onEmail: (ev) => this.setState({ email: ev.target.value }),
      senha: S.senha,
      onSenha: (ev) => this.setState({ senha: ev.target.value }),
      onEntrar: (ev) => this.entrar(ev),
      entrando: S.entrando,
      botaoEntrarLabel: S.entrando ? 'Entrando…' : 'Entrar',
      botaoEntrarStyle: `width:100%;margin-top:18px;padding:14px;font-family:Archivo,sans-serif;font-size:16px;font-weight:800;color:#FFFFFF;background:${S.entrando ? '#B4B9C2' : '#E4622A'};border:none;border-radius:10px;cursor:${S.entrando ? 'default' : 'pointer'};`,
      temLoginErro: !!S.loginErro,
      loginErro: S.loginErro,
      estNum: S.estNum != null ? dois(S.estNum) : '07',
      estNumSel: String(S.estNum || 7),
      opcoesEstaleiro: (S.estOpcoes.length ? S.estOpcoes : Array.from({ length: 46 }, (_, i) => ({
        numero: i + 1,
        localizacao: i === 0 ? 'Galpão Central' : 'Pátio de Estaleiro',
      }))).map((e) => ({
        valor: String(e.numero),
        rotulo: `Estaleiro ${dois(e.numero)}${e.localizacao ? ' · ' + e.localizacao : ''}`,
      })),
      onTrocarEstaleiro: (ev) => {
        this.setState({ estNum: parseInt(ev.target.value, 10) }, () => this.carregar());
      },
      subtitulo: S.status === 'loading' ? 'consultando estoque…' : sub.join(' · '),
      isLoading: S.status === 'loading',
      isErro: S.status === 'erro' || S.status === 'notfound' || S.status === 'semacesso',
      erroTitulo: S.status === 'notfound' ? `Estaleiro ${dois(S.estNum || 7)} não encontrado`
        : S.status === 'semacesso' ? 'Sem permissão de acesso'
          : 'Não foi possível carregar os dados',
      erroTexto: S.status === 'notfound' ? 'Confira o número impresso na placa ou selecione outro estaleiro no menu.'
        : S.status === 'semacesso' ? 'Sua conta não tem permissão para visualizar estas informações. Fale com o administrador.'
          : (S.erroMsg || 'Não foi possível consultar os dados agora. Verifique o sinal e tente novamente.'),
      isVazio: S.status === 'vazio',
      temDados: S.status === 'ok',
      recarregar: () => this.carregar(),
      totalKg: somaKg > 0 ? fmt(Math.round(somaKg), 0) + (algumSemPeso ? '+' : '') : '—',
      totalMt: fmt(somaMt, 1),
      totalPecas: fmt(somaPc, 0),
      busca: S.busca,
      buscaAtiva: q.length > 0,
      onBusca: (ev) => this.setState({ busca: ev.target.value }),
      resultadoLabel: `${filtrados.length} de ${lista.length} ${lista.length === 1 ? 'material' : 'materiais'}`,
      semResultado: q.length > 0 && filtrados.length === 0,
      itens: filtrados.map((it) => {
        const pid = it.produto_id;
        const p = S.produtos[pid] || {};
        const semDesc = !!it.pend_sem_descricao;
        const semCod = !!it.pend_sem_codigo || !it.codigo;
        const semPeso = !!it.pend_sem_peso || num(it.total_kg) == null;
        const faltas = [];
        if (semDesc) faltas.push('descrição');
        if (semCod) faltas.push('código');
        if (semPeso) faltas.push('peso');
        const kgm = num(it.kg_por_metro) ?? num(p.kg_por_metro);
        const pKg = num(p.preco_kg), pMt = num(p.preco_mt), pUn = num(p.preco_un);
        const chk = this.checarPreco(pKg, pMt, kgm);
        const incoerente = chk.ruim, aviso = chk.aviso;
        const qtdLotes = num(it.lotes) || 0;
        const L = S.lotes[pid];
        const rows = L && L.status === 'ok' ? L.rows : [];
        const numPintado = S.numeros[pid];
        return {
          numPintado: numPintado == null ? '—' : String(numPintado),
          titulo: semDesc ? (it.codigo || 'MATERIAL NÃO IDENTIFICADO') : it.descricao,
          tituloStyle: `font-size:15px;font-weight:700;line-height:1.25;color:${semDesc ? '#8A4B0B' : '#16263F'};`,
          codigoLabel: semCod ? 'SEM CÓDIGO' : it.codigo,
          codigoStyle: `font-size:12px;font-weight:700;letter-spacing:0.08em;color:${semCod ? '#A5763C' : '#7E93AE'};`,
          unidade: num(it.total_mt) ? 'MT' : 'UN',
          pendente: faltas.length > 0,
          pendLabel: 'FALTA ' + faltas.join(' · ').toUpperCase(),
          pendTexto: 'Cadastro incompleto: ' + faltas.join(', ') +
            '. Confirme com o estoque antes de fechar venda.',
          aberto: !!S.abertos[pid],
          toggle: () => this.toggle(pid),
          chevronStyle: `font-size:13px;color:#7E93AE;line-height:1;transition:transform .18s;transform:rotate(${S.abertos[pid] ? '180deg' : '0deg'});`,
          pecas: fmt(num(it.total_pecas), 0),
          metros: fmt(num(it.total_mt), 1),
          quilos: num(it.total_kg) == null ? '—' : fmt(num(it.total_kg), 0),
          precoKg: brl(pKg),
          precoMt: brl(pMt),
          precoUn: brl(pUn),
          precoData: p.preco_data ? 'preço de ' + dataBr(p.preco_data)
            : (pKg == null && pMt == null && pUn == null ? 'sem preço cadastrado' : ''),
          precoInconsistente: incoerente,
          precoAviso: aviso,
          lotesResumo: [
            qtdLotes + (qtdLotes === 1 ? ' lote' : ' lotes'),
            kgm != null ? fmt(kgm, 3) + ' kg/m' : 'kg/m —',
          ].join(' · '),
          lotesCarregando: !L || L.status === 'loading',
          lotesErro: !!L && L.status === 'erro',
          lotesOk: !!L && L.status === 'ok',
          recarregarLotes: () => this.carregarLotes(pid),
          observacoes: rows.filter((r) => r.observacao).map((r) => ({ texto: r.observacao })),
          lotes: rows.map((r, i) => {
            const qtd = num(r.quantidade) || 0;
            const pp = num(r.peso_peca_kg);
            return {
              tamanho: fmt(num(r.tamanho_m), 2) + ' m',
              qtd: fmt(qtd, 0),
              kgPeca: pp == null ? '—' : fmt(pp, 2),
              kgTotal: pp == null ? '—' : fmt(pp * qtd, 1),
              rowStyle: `display:grid;grid-template-columns:1fr 48px 1fr 1fr;gap:7px;align-items:center;padding:8px 10px;background:${i % 2 ? '#F7F9FB' : '#FFFFFF'};border-bottom:1px solid #EDF1F5;`,
            };
          }),
        };
      }),
    };
  }
}

/* ---------- Logo Oficial JPatrício Metais ---------- */
var LOGO_URL = 'https://res.cloudinary.com/dyw2bm0p4/image/upload/v1772193840/Gemini_Generated_Image_b4mrdzb4mrdzb4mr_1_dacrgw.png';
var LOGO_DATA = LOGO_URL;
window.__resources = { logoJP: LOGO_URL };

/* ---------- Instancia o Componente ---------- */
var comp = new Component();
window.__dcComponent = comp;

/* ---------- DOM Rendering Engine & Bindings ---------- */
var root = document.querySelector('x-dc');
var tplHost = document.createElement('div');
while (root.firstChild) tplHost.appendChild(root.firstChild);

var handlers = {};
var handlerCount = 0;
var pendingRefs = [];

function resolveExpr(path, ctx) {
  if (path === 'true') return true;
  if (path === 'false') return false;
  if (path === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
  var parts = path.split('.');
  var cur = ctx;
  for (var i = 0; i < parts.length; i++) {
    if (cur == null) return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

function evalAttr(val, ctx) {
  if (val == null) return undefined;
  var t = String(val).trim();
  var m = /^\{\{\s*([\s\S]*?)\s*\}\}$/.exec(t);
  if (m) return resolveExpr(m[1], ctx);
  if (t.indexOf('{{') === -1) return val;
  return t.replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, function (_, e) {
    var v = resolveExpr(e, ctx);
    return v == null ? '' : String(v);
  });
}

function interpText(text, ctx) {
  if (text.indexOf('{{') === -1) return text;
  return text.replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, function (_, e) {
    var v = resolveExpr(e, ctx);
    return v == null ? '' : String(v);
  });
}

function buildChildren(tplParent, ctx, domParent, path) {
  var kids = tplParent.childNodes;
  for (var i = 0; i < kids.length; i++) buildNode(kids[i], ctx, domParent, path + '.' + i);
}

function buildNode(node, ctx, domParent, path) {
  if (node.nodeType === 3) {
    var t = interpText(node.data, ctx);
    if (t) domParent.appendChild(document.createTextNode(t));
    return;
  }
  if (node.nodeType !== 1) return;
  var tag = node.tagName.toLowerCase();
  if (tag === 'sc-if') {
    if (evalAttr(node.getAttribute('value'), ctx)) buildChildren(node, ctx, domParent, path);
    return;
  }
  if (tag === 'sc-for') {
    var list = evalAttr(node.getAttribute('list'), ctx) || [];
    var as = node.getAttribute('as') || 'item';
    for (var i = 0; i < list.length; i++) {
      var c2 = Object.create(ctx);
      c2[as] = list[i];
      buildChildren(node, c2, domParent, path + '[' + i + ']');
    }
    return;
  }
  var realTag = (tag === 'sc-raw-select') ? 'select' : tag;
  var el = document.createElement(realTag);
  var pendingValue = null;
  var attrs = node.attributes;
  for (var a = 0; a < attrs.length; a++) {
    var name = attrs[a].name, raw = attrs[a].value;
    if (name.indexOf('hint-') === 0) continue;
    if (name.indexOf('sc-camel-on-') === 0) {
      var evName = name.slice(12);
      var fn = evalAttr(raw, ctx);
      if (typeof fn === 'function') {
        var hid = 'h' + (++handlerCount);
        handlers[hid] = fn;
        el.setAttribute('data-ev-' + evName, hid);
      }
      continue;
    }
    if (name === 'ref') {
      var rf = evalAttr(raw, ctx);
      if (typeof rf === 'function') pendingRefs.push([rf, el]);
      continue;
    }
    if (name === 'style-hover' || name === 'style-focus') {
      el.setAttribute('data-' + name, raw);
      continue;
    }
    if (name === 'value') { pendingValue = evalAttr(raw, ctx); continue; }
    if (name === 'checked') { if (evalAttr(raw, ctx)) el.checked = true; continue; }
    if (name === 'disabled') { if (evalAttr(raw, ctx)) el.disabled = true; continue; }
    var v = evalAttr(raw, ctx);
    if (v === undefined || v === null || v === false) {
      if (raw.indexOf('{{') === -1) el.setAttribute(name, raw);
      continue;
    }
    el.setAttribute(name, String(v));
  }
  if (realTag === 'input' || realTag === 'select' || realTag === 'textarea' ||
    /overflow(-y)?\s*:\s*(auto|scroll)/.test(el.style.cssText || '')) {
    el.setAttribute('data-dcid', path);
  }
  domParent.appendChild(el);
  buildChildren(node, ctx, el, path);
  if (pendingValue != null) { try { el.value = pendingValue; } catch (e) { } }
}

function findHandler(target, evName) {
  var el = target;
  while (el && el.getAttribute) {
    var id = el.getAttribute('data-ev-' + evName);
    if (id && handlers[id]) return handlers[id];
    el = el.parentElement;
  }
  return null;
}

document.addEventListener('click', function (e) {
  var fn = findHandler(e.target, 'click');
  if (fn) fn(e);
});
document.addEventListener('submit', function (e) {
  var fn = findHandler(e.target, 'submit');
  if (fn) { e.preventDefault(); fn(e); }
});
document.addEventListener('input', function (e) {
  var fn = findHandler(e.target, 'input');
  if (fn) fn(e);
});
document.addEventListener('change', function (e) {
  var fn = findHandler(e.target, 'change');
  if (fn) fn(e);
});
document.addEventListener('focusout', function (e) {
  var fn = findHandler(e.target, 'blur');
  if (fn) fn(e);
});

function toggleDecls(el, css, on) {
  var decls = String(css).split(';');
  for (var i = 0; i < decls.length; i++) {
    var d = decls[i].trim();
    if (!d) continue;
    var ci = d.indexOf(':');
    if (ci < 0) continue;
    var prop = d.slice(0, ci).trim(), val = d.slice(ci + 1).trim();
    if (on) {
      if (!el.__dcOrig) el.__dcOrig = {};
      if (!(prop in el.__dcOrig)) el.__dcOrig[prop] = el.style.getPropertyValue(prop);
      el.style.setProperty(prop, val);
    } else if (el.__dcOrig && (prop in el.__dcOrig)) {
      var old = el.__dcOrig[prop];
      if (old) el.style.setProperty(prop, old); else el.style.removeProperty(prop);
      delete el.__dcOrig[prop];
    }
  }
}

function climbForAttr(target, attr) {
  var el = target;
  while (el && el.getAttribute) {
    if (el.getAttribute(attr)) return el;
    el = el.parentElement;
  }
  return null;
}

document.addEventListener('mouseover', function (e) {
  var el = climbForAttr(e.target, 'data-style-hover');
  if (el) toggleDecls(el, el.getAttribute('data-style-hover'), true);
});
document.addEventListener('mouseout', function (e) {
  var el = climbForAttr(e.target, 'data-style-hover');
  if (el) toggleDecls(el, el.getAttribute('data-style-hover'), false);
});
document.addEventListener('focusin', function (e) {
  var css = e.target.getAttribute && e.target.getAttribute('data-style-focus');
  if (css) toggleDecls(e.target, css, true);
});
document.addEventListener('focusout', function (e) {
  var css = e.target.getAttribute && e.target.getAttribute('data-style-focus');
  if (css) toggleDecls(e.target, css, false);
});

function doRender() {
  renderPending = false;
  var focusId = null, selS = null, selE = null;
  var active = document.activeElement;
  if (active && active !== document.body && active.getAttribute &&
    active.getAttribute('data-dcid') && root.contains(active)) {
    focusId = active.getAttribute('data-dcid');
    try { selS = active.selectionStart; selE = active.selectionEnd; } catch (e) { }
  }
  var scrollables = [];
  var sc = root.querySelectorAll('[data-dcid]');
  for (var i = 0; i < sc.length; i++) {
    if (sc[i].scrollTop > 0) scrollables.push([sc[i].getAttribute('data-dcid'), sc[i].scrollTop]);
  }
  handlers = {};
  handlerCount = 0;
  pendingRefs = [];
  var ctx = comp.renderVals();
  var frag = document.createDocumentFragment();
  buildChildren(tplHost, ctx, frag, 'r');
  root.textContent = '';
  root.appendChild(frag);

  // Renderizar imagens de logo estáticas
  Array.prototype.forEach.call(root.querySelectorAll('img[data-logo]'), function (im) { im.src = LOGO_DATA; });

  for (var rI = 0; rI < pendingRefs.length; rI++) {
    try { pendingRefs[rI][0](pendingRefs[rI][1]); } catch (e) { }
  }
  if (focusId) {
    var fe = root.querySelector('[data-dcid="' + focusId + '"]');
    if (fe) {
      fe.focus();
      if (selS != null) { try { fe.setSelectionRange(selS, selE); } catch (e) { } }
    }
  }
  for (var sI = 0; sI < scrollables.length; sI++) {
    var se = root.querySelector('[data-dcid="' + scrollables[sI][0] + '"]');
    if (se) se.scrollTop = scrollables[sI][1];
  }
}

// Carrega dados iniciais do modo de teste
try {
  comp.carregarOpcoes();
  comp.carregarPainel();
  if (comp.state.estNum) comp.carregar();
} catch (e) { }

// Inicia primeira renderização
doRender();

// Redimensionamento automático responsivo
window.addEventListener('resize', function() {
  var m = window.innerWidth <= 768 ? 'celular' : 'desktop';
  if (comp.state.modo !== m) {
    comp.setState({ modo: m });
  }
});

