-- ==============================================================================
-- SISTEMA DE CATALOGAÇÃO DE TUBOS EM ESTALEIROS - JPATRÍCIO METAIS
-- Script de Inicialização do Banco de Dados Supabase (PostgreSQL)
-- ==============================================================================

-- 1. EXTENSÕES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABELAS

-- Estaleiros / Unidades Físicas
CREATE TABLE IF NOT EXISTS public.estaleiros (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero INTEGER NOT NULL UNIQUE,
    localizacao TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cadastro de Materiais (Tubos)
CREATE TABLE IF NOT EXISTS public.produtos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo TEXT UNIQUE,
    descricao TEXT,
    kg_por_metro NUMERIC(10, 4),
    preco_kg NUMERIC(10, 2),
    preco_mt NUMERIC(10, 2),
    preco_un NUMERIC(10, 2),
    preco_data DATE,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Itens vinculados aos Estaleiros (Número Pintado no Tubo)
CREATE TABLE IF NOT EXISTS public.itens_estaleiro (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estaleiro_id UUID NOT NULL REFERENCES public.estaleiros(id) ON DELETE CASCADE,
    produto_id UUID NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
    numero INTEGER NOT NULL,
    vazio_desde TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT itens_estaleiro_est_prod_key UNIQUE (estaleiro_id, produto_id),
    CONSTRAINT itens_estaleiro_est_num_key UNIQUE (estaleiro_id, numero)
);

-- Lotes de Tubos no Pátio
CREATE TABLE IF NOT EXISTS public.lotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estaleiro_id UUID NOT NULL REFERENCES public.estaleiros(id) ON DELETE CASCADE,
    produto_id UUID NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
    quantidade NUMERIC(10, 2) NOT NULL CHECK (quantidade > 0),
    tamanho_m NUMERIC(10, 2) NOT NULL CHECK (tamanho_m > 0),
    peso_peca_kg NUMERIC(10, 3),
    observacao TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Perfil de Usuários (Sincronizado com auth.users)
CREATE TABLE IF NOT EXISTS public.usuarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    nome TEXT NOT NULL,
    email TEXT NOT NULL,
    papel TEXT NOT NULL CHECK (papel IN ('admin', 'vendedor')),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Registro / Auditoria de Movimentações
CREATE TABLE IF NOT EXISTS public.auditoria_movimentos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tipo TEXT NOT NULL, -- 'entrada', 'saida', 'alteracao', 'exclusao', 'importacao'
    estaleiro_id UUID REFERENCES public.estaleiros(id) ON DELETE SET NULL,
    produto_id UUID REFERENCES public.produtos(id) ON DELETE SET NULL,
    lote_id UUID,
    delta_pecas NUMERIC(10, 2),
    delta_mt NUMERIC(10, 2),
    delta_kg NUMERIC(10, 2),
    usuario_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    autor_nome TEXT,
    origem TEXT DEFAULT 'sistema'
);

-- Histórico de Preços
CREATE TABLE IF NOT EXISTS public.auditoria_precos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    produto_id UUID REFERENCES public.produtos(id) ON DELETE CASCADE,
    campo TEXT NOT NULL,
    valor_antes NUMERIC(10, 2),
    valor_depois NUMERIC(10, 2),
    usuario_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    autor_nome TEXT
);

-- Audit Trail Geral
CREATE TABLE IF NOT EXISTS public.auditoria_geral (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tabela TEXT NOT NULL,
    operacao TEXT NOT NULL,
    registro TEXT,
    usuario_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    autor_nome TEXT
);


-- 3. VISÕES (VIEWS)

-- Visão Consolidada de Itens por Estaleiro
CREATE OR REPLACE VIEW public.vw_estaleiro_itens AS
SELECT 
    e.numero AS estaleiro,
    e.id AS estaleiro_id,
    p.id AS produto_id,
    p.codigo,
    p.descricao,
    p.kg_por_metro,
    ie.numero AS n_pintado,
    COUNT(l.id) AS lotes,
    COALESCE(SUM(l.quantidade), 0) AS total_pecas,
    COALESCE(SUM(l.quantidade * l.tamanho_m), 0) AS total_mt,
    COALESCE(SUM(l.quantidade * COALESCE(l.peso_peca_kg, l.tamanho_m * p.kg_por_metro)), 0) AS total_kg,
    (p.descricao IS NULL OR TRIM(p.descricao) = '') AS pend_sem_descricao,
    (p.codigo IS NULL OR TRIM(p.codigo) = '') AS pend_sem_codigo,
    (p.kg_por_metro IS NULL OR p.kg_por_metro <= 0) AS pend_sem_peso
FROM public.itens_estaleiro ie
JOIN public.estaleiros e ON ie.estaleiro_id = e.id
JOIN public.produtos p ON ie.produto_id = p.id
LEFT JOIN public.lotes l ON l.estaleiro_id = ie.estaleiro_id AND l.produto_id = ie.produto_id
GROUP BY e.numero, e.id, p.id, p.codigo, p.descricao, p.kg_por_metro, ie.numero;

-- Visão de Itens Reservados Sem Lotes no Pátio (Vazios)
CREATE OR REPLACE VIEW public.vw_itens_vazios AS
SELECT 
    e.numero AS estaleiro,
    ie.numero AS n_pintado,
    p.codigo,
    p.descricao,
    ie.vazio_desde,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(ie.vazio_desde, NOW()))) / 86400))::INTEGER AS dias_vazio
FROM public.itens_estaleiro ie
JOIN public.estaleiros e ON ie.estaleiro_id = e.id
JOIN public.produtos p ON ie.produto_id = p.id
LEFT JOIN public.lotes l ON l.estaleiro_id = ie.estaleiro_id AND l.produto_id = ie.produto_id
GROUP BY e.numero, ie.numero, p.codigo, p.descricao, ie.vazio_desde
HAVING COUNT(l.id) = 0;

-- Visão de Relatório de Movimentações
CREATE OR REPLACE VIEW public.vw_rel_movimentos AS
SELECT 
    am.id,
    am.em,
    am.tipo,
    e.numero AS estaleiro,
    COALESCE(p.descricao, p.codigo, 'Material Excluído') AS material,
    p.codigo,
    am.delta_pecas,
    am.delta_mt,
    am.delta_kg,
    COALESCE(am.autor_nome, u.nome, u.email, 'Sistema') AS autor,
    am.origem
FROM public.auditoria_movimentos am
LEFT JOIN public.estaleiros e ON am.estaleiro_id = e.id
LEFT JOIN public.produtos p ON am.produto_id = p.id
LEFT JOIN public.usuarios u ON am.usuario_id = u.user_id
ORDER BY am.em DESC;

-- Visão de Relatório de Histórico de Preços
CREATE OR REPLACE VIEW public.vw_rel_precos AS
SELECT 
    ap.id,
    ap.em,
    COALESCE(p.descricao, p.codigo) AS material,
    p.codigo,
    ap.campo,
    ap.valor_antes,
    ap.valor_depois,
    COALESCE(ap.autor_nome, u.nome, u.email, 'Sistema') AS autor
FROM public.auditoria_precos ap
LEFT JOIN public.produtos p ON ap.produto_id = p.id
LEFT JOIN public.usuarios u ON ap.usuario_id = u.user_id
ORDER BY ap.em DESC;

-- Visão de Relatório de Auditoria Geral
CREATE OR REPLACE VIEW public.vw_rel_auditoria AS
SELECT 
    ag.id,
    ag.em,
    ag.tabela,
    ag.operacao,
    ag.registro,
    COALESCE(ag.autor_nome, u.nome, u.email, 'Sistema') AS autor
FROM public.auditoria_geral ag
LEFT JOIN public.usuarios u ON ag.usuario_id = u.user_id
ORDER BY ag.em DESC;

-- Visão de Resumo por Usuário
CREATE OR REPLACE VIEW public.vw_rel_por_usuario AS
SELECT 
    u.nome,
    u.email,
    COUNT(ag.id) AS alteracoes,
    MAX(ag.em) AS ultima_em
FROM public.usuarios u
LEFT JOIN public.auditoria_geral ag ON u.user_id = ag.usuario_id
GROUP BY u.nome, u.email
ORDER BY alteracoes DESC;


-- 4. FUNÇÕES ARMAZENADAS (RPCs)

-- Retorna o próximo número pintado disponível para um estaleiro
CREATE OR REPLACE FUNCTION public.proximo_numero(p_estaleiro UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_proximo INTEGER;
BEGIN
    SELECT COALESCE(MAX(numero), 0) + 1 INTO v_proximo
    FROM public.itens_estaleiro
    WHERE estaleiro_id = p_estaleiro;
    
    RETURN v_proximo;
END;
$$;

-- Encerra um item sem lotes (liberando o número no estaleiro)
CREATE OR REPLACE FUNCTION public.encerrar_item(p_estaleiro UUID, p_produto UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_qtd_lotes INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_qtd_lotes
    FROM public.lotes
    WHERE estaleiro_id = p_estaleiro AND produto_id = p_produto;

    IF v_qtd_lotes > 0 THEN
        RAISE EXCEPTION 'Não é possível encerrar: ainda existem lotes cadastrados para este item.';
    END IF;

    DELETE FROM public.itens_estaleiro
    WHERE estaleiro_id = p_estaleiro AND produto_id = p_produto;

    RETURN TRUE;
END;
$$;


-- 5. TRIGGERS DE AUTOMAÇÃO E AUDITORIA

-- Atualiza "vazio_desde" na tabela itens_estaleiro ao mudar lotes
CREATE OR REPLACE FUNCTION public.trg_atualizar_vazio_desde()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_estaleiro UUID;
    v_produto UUID;
    v_qtd INTEGER;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_estaleiro := OLD.estaleiro_id;
        v_produto := OLD.produto_id;
    ELSE
        v_estaleiro := NEW.estaleiro_id;
        v_produto := NEW.produto_id;
    END IF;

    SELECT COUNT(*) INTO v_qtd
    FROM public.lotes
    WHERE estaleiro_id = v_estaleiro AND produto_id = v_produto;

    IF v_qtd = 0 THEN
        UPDATE public.itens_estaleiro
        SET vazio_desde = COALESCE(vazio_desde, NOW())
        WHERE estaleiro_id = v_estaleiro AND produto_id = v_produto;
    ELSE
        UPDATE public.itens_estaleiro
        SET vazio_desde = NULL
        WHERE estaleiro_id = v_estaleiro AND produto_id = v_produto;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_lotes_vazio ON public.lotes;
CREATE TRIGGER trg_lotes_vazio
AFTER INSERT OR UPDATE OR DELETE ON public.lotes
FOR EACH ROW EXECUTE FUNCTION public.trg_atualizar_vazio_desde();

-- Auditoria automática de Movimentos de Lotes (Entrada / Saída / Alteração / Exclusão)
CREATE OR REPLACE FUNCTION public.trg_auditar_movimentos_lotes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_user_id UUID;
    v_nome TEXT;
    v_kg_metro NUMERIC;
    v_delta_pecas NUMERIC;
    v_delta_mt NUMERIC;
    v_delta_kg NUMERIC;
    v_tipo TEXT;
    v_estaleiro UUID;
    v_produto UUID;
    v_lote_id UUID;
    v_desc TEXT;
BEGIN
    v_user_id := auth.uid();
    SELECT nome INTO v_nome FROM public.usuarios WHERE user_id = v_user_id;

    IF TG_OP = 'INSERT' THEN
        v_tipo := 'entrada';
        v_estaleiro := NEW.estaleiro_id;
        v_produto := NEW.produto_id;
        v_lote_id := NEW.id;
        v_delta_pecas := NEW.quantidade;
        v_delta_mt := NEW.quantidade * NEW.tamanho_m;
        
        SELECT kg_por_metro, descricao INTO v_kg_metro, v_desc FROM public.produtos WHERE id = NEW.produto_id;
        v_delta_kg := NEW.quantidade * COALESCE(NEW.peso_peca_kg, NEW.tamanho_m * COALESCE(v_kg_metro, 0));

        INSERT INTO public.auditoria_movimentos (tipo, estaleiro_id, produto_id, lote_id, delta_pecas, delta_mt, delta_kg, usuario_id, autor_nome)
        VALUES (v_tipo, v_estaleiro, v_produto, v_lote_id, v_delta_pecas, v_delta_mt, v_delta_kg, v_user_id, v_nome);

        INSERT INTO public.auditoria_geral (tabela, operacao, registro, usuario_id, autor_nome)
        VALUES ('lotes', 'INSERT', 'Adicionou lote de ' || v_delta_pecas || ' peças (' || COALESCE(v_desc, '') || ')', v_user_id, v_nome);

    ELSIF TG_OP = 'UPDATE' THEN
        v_tipo := 'alteracao';
        v_estaleiro := NEW.estaleiro_id;
        v_produto := NEW.produto_id;
        v_lote_id := NEW.id;
        v_delta_pecas := NEW.quantidade - OLD.quantidade;
        v_delta_mt := (NEW.quantidade * NEW.tamanho_m) - (OLD.quantidade * OLD.tamanho_m);
        
        SELECT kg_por_metro, descricao INTO v_kg_metro, v_desc FROM public.produtos WHERE id = NEW.produto_id;
        v_delta_kg := (NEW.quantidade * COALESCE(NEW.peso_peca_kg, NEW.tamanho_m * COALESCE(v_kg_metro, 0))) - 
                      (OLD.quantidade * COALESCE(OLD.peso_peca_kg, OLD.tamanho_m * COALESCE(v_kg_metro, 0)));

        INSERT INTO public.auditoria_movimentos (tipo, estaleiro_id, produto_id, lote_id, delta_pecas, delta_mt, delta_kg, usuario_id, autor_nome)
        VALUES (v_tipo, v_estaleiro, v_produto, v_lote_id, v_delta_pecas, v_delta_mt, v_delta_kg, v_user_id, v_nome);

        INSERT INTO public.auditoria_geral (tabela, operacao, registro, usuario_id, autor_nome)
        VALUES ('lotes', 'UPDATE', 'Alterou lote ID ' || v_lote_id, v_user_id, v_nome);

    ELSIF TG_OP = 'DELETE' THEN
        v_tipo := 'saida';
        v_estaleiro := OLD.estaleiro_id;
        v_produto := OLD.produto_id;
        v_lote_id := OLD.id;
        v_delta_pecas := -OLD.quantidade;
        v_delta_mt := -(OLD.quantidade * OLD.tamanho_m);
        
        SELECT kg_por_metro, descricao INTO v_kg_metro, v_desc FROM public.produtos WHERE id = OLD.produto_id;
        v_delta_kg := -(OLD.quantidade * COALESCE(OLD.peso_peca_kg, OLD.tamanho_m * COALESCE(v_kg_metro, 0)));

        INSERT INTO public.auditoria_movimentos (tipo, estaleiro_id, produto_id, lote_id, delta_pecas, delta_mt, delta_kg, usuario_id, autor_nome)
        VALUES (v_tipo, v_estaleiro, v_produto, v_lote_id, v_delta_pecas, v_delta_mt, v_delta_kg, v_user_id, v_nome);

        INSERT INTO public.auditoria_geral (tabela, operacao, registro, usuario_id, autor_nome)
        VALUES ('lotes', 'DELETE', 'Excluiu lote de ' || OLD.quantidade || ' peças (' || COALESCE(v_desc, '') || ')', v_user_id, v_nome);
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_auditar_lotes ON public.lotes;
CREATE TRIGGER trg_auditar_lotes
AFTER INSERT OR UPDATE OR DELETE ON public.lotes
FOR EACH ROW EXECUTE FUNCTION public.trg_auditar_movimentos_lotes();

-- Auditoria automática de Alterações de Preço nos Produtos
CREATE OR REPLACE FUNCTION public.trg_auditar_precos_produtos()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_user_id UUID;
    v_nome TEXT;
BEGIN
    v_user_id := auth.uid();
    SELECT nome INTO v_nome FROM public.usuarios WHERE user_id = v_user_id;

    IF (OLD.preco_kg IS DISTINCT FROM NEW.preco_kg) THEN
        INSERT INTO public.auditoria_precos (produto_id, campo, valor_antes, valor_depois, usuario_id, autor_nome)
        VALUES (NEW.id, 'preco_kg', OLD.preco_kg, NEW.preco_kg, v_user_id, v_nome);
    END IF;

    IF (OLD.preco_mt IS DISTINCT FROM NEW.preco_mt) THEN
        INSERT INTO public.auditoria_precos (produto_id, campo, valor_antes, valor_depois, usuario_id, autor_nome)
        VALUES (NEW.id, 'preco_mt', OLD.preco_mt, NEW.preco_mt, v_user_id, v_nome);
    END IF;

    IF (OLD.preco_un IS DISTINCT FROM NEW.preco_un) THEN
        INSERT INTO public.auditoria_precos (produto_id, campo, valor_antes, valor_depois, usuario_id, autor_nome)
        VALUES (NEW.id, 'preco_un', OLD.preco_un, NEW.preco_un, v_user_id, v_nome);
    END IF;

    INSERT INTO public.auditoria_geral (tabela, operacao, registro, usuario_id, autor_nome)
    VALUES ('produtos', 'UPDATE', 'Atualizou material ' || COALESCE(NEW.codigo, NEW.descricao, ''), v_user_id, v_nome);

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_auditar_produtos ON public.produtos;
CREATE TRIGGER trg_auditar_produtos
AFTER UPDATE ON public.produtos
FOR EACH ROW EXECUTE FUNCTION public.trg_auditar_precos_produtos();


-- 6. POLÍTICAS DE SEGURANÇA (RLS - ROW LEVEL SECURITY)

ALTER TABLE public.estaleiros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itens_estaleiro ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria_movimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria_precos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria_geral ENABLE ROW LEVEL SECURITY;

-- Leitura: Qualquer usuário autenticado
CREATE POLICY "Leitura autenticada estaleiros" ON public.estaleiros FOR SELECT TO authenticated USING (true);
CREATE POLICY "Leitura autenticada produtos" ON public.produtos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Leitura autenticada itens_estaleiro" ON public.itens_estaleiro FOR SELECT TO authenticated USING (true);
CREATE POLICY "Leitura autenticada lotes" ON public.lotes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Leitura autenticada usuarios" ON public.usuarios FOR SELECT TO authenticated USING (true);
CREATE POLICY "Leitura autenticada auditoria_movimentos" ON public.auditoria_movimentos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Leitura autenticada auditoria_precos" ON public.auditoria_precos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Leitura autenticada auditoria_geral" ON public.auditoria_geral FOR SELECT TO authenticated USING (true);

-- Escrita: Apenas administradores ou service_role
CREATE POLICY "Escrita admin produtos" ON public.produtos FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.usuarios WHERE user_id = auth.uid() AND papel = 'admin' AND ativo = true)
);

CREATE POLICY "Escrita admin lotes" ON public.lotes FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.usuarios WHERE user_id = auth.uid() AND papel = 'admin' AND ativo = true)
);

CREATE POLICY "Escrita admin itens_estaleiro" ON public.itens_estaleiro FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.usuarios WHERE user_id = auth.uid() AND papel = 'admin' AND ativo = true)
);

CREATE POLICY "Escrita admin estaleiros" ON public.estaleiros FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.usuarios WHERE user_id = auth.uid() AND papel = 'admin' AND ativo = true)
);

-- 7. DADOS INICIAIS DE DEMONSTRAÇÃO / SEED

INSERT INTO public.estaleiros (numero, localizacao) VALUES
(1, 'Galpão Central'), (2, 'Pátio de Estaleiro'), (3, 'Pátio de Estaleiro'), (4, 'Pátio de Estaleiro'), (5, 'Pátio de Estaleiro'),
(6, 'Pátio de Estaleiro'), (7, 'Pátio de Estaleiro'), (8, 'Pátio de Estaleiro'), (9, 'Pátio de Estaleiro'), (10, 'Pátio de Estaleiro'),
(11, 'Pátio de Estaleiro'), (12, 'Pátio de Estaleiro'), (13, 'Pátio de Estaleiro'), (14, 'Pátio de Estaleiro'), (15, 'Pátio de Estaleiro'),
(16, 'Pátio de Estaleiro'), (17, 'Pátio de Estaleiro'), (18, 'Pátio de Estaleiro'), (19, 'Pátio de Estaleiro'), (20, 'Pátio de Estaleiro'),
(21, 'Pátio de Estaleiro'), (22, 'Pátio de Estaleiro'), (23, 'Pátio de Estaleiro'), (24, 'Pátio de Estaleiro'), (25, 'Pátio de Estaleiro'),
(26, 'Pátio de Estaleiro'), (27, 'Pátio de Estaleiro'), (28, 'Pátio de Estaleiro'), (29, 'Pátio de Estaleiro'), (30, 'Pátio de Estaleiro'),
(31, 'Pátio de Estaleiro'), (32, 'Pátio de Estaleiro'), (33, 'Pátio de Estaleiro'), (34, 'Pátio de Estaleiro'), (35, 'Pátio de Estaleiro'),
(36, 'Pátio de Estaleiro'), (37, 'Pátio de Estaleiro'), (38, 'Pátio de Estaleiro'), (39, 'Pátio de Estaleiro'), (40, 'Pátio de Estaleiro'),
(41, 'Pátio de Estaleiro'), (42, 'Pátio de Estaleiro'), (43, 'Pátio de Estaleiro'), (44, 'Pátio de Estaleiro'), (45, 'Pátio de Estaleiro'),
(46, 'Pátio de Estaleiro')
ON CONFLICT (numero) DO UPDATE SET localizacao = EXCLUDED.localizacao;

INSERT INTO public.produtos (codigo, descricao, kg_por_metro, preco_kg, preco_mt, preco_un, preco_data, ativo) VALUES
('TUB101', 'Tubo Redondo 2" x 2,00 mm', 2.450, 8.50, 20.82, 124.95, CURRENT_DATE, true),
('TUB102', 'Tubo Quadrado 50x50 x 3,00 mm', 4.120, 8.90, 36.67, 220.00, CURRENT_DATE, true),
('TUB103', 'Tubo Retangular 80x40 x 2,50 mm', 4.480, 8.70, 38.98, 233.85, CURRENT_DATE, true)
ON CONFLICT (codigo) DO NOTHING;
