import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ erro: "Configuração do servidor ausente (SUPABASE_SERVICE_ROLE_KEY)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cliente com permissão total (Service Role)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Cliente com as credenciais do chamador (para verificar token e papel)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ erro: "Não autorizado: token ausente" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ erro: "Sessão inválida ou expirada" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verificar se o usuário chamador tem papel de 'admin' na tabela public.usuarios
    const { data: usuarioRecord, error: usuarioErr } = await supabaseAdmin
      .from("usuarios")
      .select("papel, ativo")
      .eq("user_id", user.id)
      .single();

    if (usuarioErr || !usuarioRecord || usuarioRecord.papel !== "admin" || !usuarioRecord.ativo) {
      return new Response(
        JSON.stringify({ erro: "Sem permissão: Apenas administradores ativos podem gerenciar contas" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { acao } = body;

    // AÇÃO: LISTAR CONTAS
    if (acao === "listar") {
      const { data: lista, error } = await supabaseAdmin
        .from("usuarios")
        .select("id, user_id, nome, email, papel, ativo, created_at")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return new Response(JSON.stringify(lista), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // AÇÃO: CRIAR NOVA CONTA
    if (acao === "criar") {
      const { nome, email, senha, papel } = body;

      if (!nome || !email || !senha) {
        return new Response(
          JSON.stringify({ erro: "Nome, e-mail e senha são obrigatórios" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 1. Criar usuário no auth.users
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: email.trim(),
        password: senha,
        email_confirm: true,
        user_metadata: { nome },
      });

      if (createError) throw createError;

      // 2. Inserir registro correspondente na tabela public.usuarios
      const { error: insertError } = await supabaseAdmin.from("usuarios").insert({
        user_id: newUser.user.id,
        nome: nome.trim(),
        email: email.trim(),
        papel: papel === "admin" ? "admin" : "vendedor",
        ativo: true,
      });

      if (insertError) {
        // Rollback caso a inserção falhe
        await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
        throw insertError;
      }

      return new Response(
        JSON.stringify({ mensagem: "Conta criada com sucesso", user: newUser.user }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // AÇÃO: ATUALIZAR CONTA (PAPEL OU SITUAÇÃO)
    if (acao === "atualizar") {
      const { user_id, papel, ativo } = body;

      if (!user_id) {
        return new Response(
          JSON.stringify({ erro: "ID do usuário não informado" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const updates: Record<string, any> = {};
      if (papel !== undefined) updates.papel = papel;
      if (ativo !== undefined) updates.ativo = ativo;

      const { error: updateErr } = await supabaseAdmin
        .from("usuarios")
        .update(updates)
        .eq("user_id", user_id);

      if (updateErr) throw updateErr;

      return new Response(
        JSON.stringify({ mensagem: "Conta atualizada com sucesso" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // AÇÃO: NOVA SENHA
    if (acao === "nova_senha") {
      const { user_id, senha } = body;

      if (!user_id || !senha || senha.length < 8) {
        return new Response(
          JSON.stringify({ erro: "A nova senha deve ter no mínimo 8 caracteres" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: pwdErr } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
        password: senha,
      });

      if (pwdErr) throw pwdErr;

      return new Response(
        JSON.stringify({ mensagem: "Senha alterada com sucesso" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ erro: "Ação não reconhecida" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ erro: err.message || "Erro interno do servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
