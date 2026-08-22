# 🏭 Sistema de Catalogação de Tubos em Estaleiros — JPatrício Metais

Este repositório contém o código completo e a documentação para o sistema de catalogação e gestão de estoque de tubos nos estaleiros da **JPatrício Metais**.

---

## 📌 Visão Geral do Sistema

O sistema foi desenvolvido para resolver a catalogação física e digital de tubos em diferentes unidades/estaleiros:
1. **Catalogação por Estaleiro e Número Pintado**: Cada tubo físico no pátio recebe um número pintado associado ao seu estaleiro.
2. **Placas com QR Code por Unidade**: Cada estaleiro possui uma placa A4 com QR Code. Ao apontar a câmera do celular, o usuário é levado diretamente para a visão daquela unidade.
3. **Níveis de Acesso e Segurança**:
   - **Vendedores**: Consultam quantidades (peças, metros, quilos), preços (R$/kg, R$/metro, R$/unidade) e relatórios de consulta.
   - **Administradores**: Têm acesso total para cadastrar novos materiais, adicionar/editar/excluir lotes no pátio, atualizar preços, encerrar tubos e criar/gerenciar contas de usuários.
4. **Leitura Direta no Supabase**: Banco de dados relacional PostgreSQL com segurança em nível de linha (RLS) e atualização em tempo real.

---

## 📁 Estrutura de Pastas do Repositório

```text
sistema-estaleiros/
├── index.html                  # Interface gráfica web (Tela principal da aplicação)
├── assets/
│   ├── css/
│   │   └── style.css           # Estilos visuais, layout responsivo e animações
│   └── js/
│       ├── config.js           # Credenciais do Supabase (URL e API Key Publicável)
│       ├── utils.js            # Formatadores de moeda, pesos e gerador de QR Code
│       └── app.js              # Lógica de componentes e chamadas de API (DCLogic)
├── supabase/
│   ├── schema.sql              # Script SQL completo (Cria Tabelas, Views, RPCs e RLS)
│   └── functions/
│       └── gerenciar-contas/
│           └── index.ts        # Edge Function Deno/TypeScript para gestão de usuários
└── README.md                   # Este guia passo a passo
```

---

## 🚀 PASSO A PASSO PARA CONFIGURAÇÃO (PASSO A PASSO PARA LEIGOS)

---

### PASSO 1: Criar a Conta e o Projeto no Supabase

1. Acesse o site oficial do Supabase: [https://supabase.com](https://supabase.com)
2. Clique no botão **"Start your project"** e faça login (pode usar sua conta do GitHub ou Google).
3. No painel principal, clique em **"New Project"** (Novo Projeto).
4. Preencha os dados:
   - **Name**: `Estaleiros JPatrício`
   - **Database Password**: Escolha uma senha forte e guarde-a.
   - **Region**: Selecione `Saõ Paulo (sa-east-1)` para menor latência.
5. Clique em **"Create new project"** e aguarde cerca de 2 minutos até o projeto ser inicializado.

---

### PASSO 2: Montar o Banco de Dados no Supabase

1. No menu lateral esquerdo do Supabase, clique no ícone **SQL Editor** (ícone que parece um código `</>`).
2. Clique no botão **"New Query"** (Nova Consulta).
3. Abra o arquivo [`supabase/schema.sql`](supabase/schema.sql) deste repositório, copie todo o seu conteúdo e cole dentro do editor do Supabase.
4. Clique no botão **"Run"** (ou aperte `Ctrl + Enter`).
5. Você verá a mensagem **"Success. No rows returned"**. Todas as tabelas, visões, funções e permissões foram criadas com sucesso!

---

### PASSO 3: Pegar as Credenciais e Conectar ao Front-end

1. No menu lateral do Supabase, vá em **Project Settings** (Engrenagem no canto inferior esquerdo) e selecione **API Keys** (ou **API**).
2. Você encontrará duas informações importantes:
   - **Project URL**: Algo como `https://abcdefghijk.supabase.co`
   - **Project API Keys (anon / publishable)**: Uma chave longa começando com `eyJ...` ou `sb_publishable_...`
3. No seu computador, abra o arquivo [`assets/js/config.js`](assets/js/config.js) em um editor de texto (como Bloco de Notas ou VS Code).
4. Substitua os valores de `SB_URL` e `SB_KEY` pelas chaves do seu projeto:

```javascript
const SB_URL = 'SUA_URL_DO_SUPABASE_AQUI';
const SB_KEY = 'SUA_CHAVE_PUBLISHABLE_AQUI';
```

---

### PASSO 4: Criar o Primeiro Usuário Administrador

Para conseguir fazer login no sistema como Admin:

1. No painel do Supabase, vá em **Authentication** -> **Users**.
2. Clique em **"Add User"** -> **"Create User"**.
3. Digite o e-mail (ex: `admin@jpatricio.com.br`) e crie uma senha.
4. Agora clique no menu **Table Editor** (ícone de tabela) no menu esquerdo e abra a tabela **`usuarios`**.
5. Clique em **"Insert row"** para criar o perfil correspondente:
   - **user_id**: Selecione o ID do usuário que você acabou de criar no menu Authentication.
   - **nome**: Seu Nome (ex: `Administrador`)
   - **email**: `admin@jpatricio.com.br`
   - **papel**: Digite exatamente `admin`
   - **ativo**: Marque como `true`
6. Clique em **Save**. Pronto! Agora você tem um usuário Admin cadastrado.

---

### PASSO 5: Publicar a Edge Function de Gestão de Contas (Opcional, para Admins criarem contas pela tela)

A criação de contas diretamente pelo painel Admin precisa da Edge Function `gerenciar-contas`.

1. Instale a CLI do Supabase ou publique via Supabase Dashboard.
2. Na CLI do terminal, execute:
```bash
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase functions deploy gerenciar-contas
```

---

### PASSO 6: Criar o Repositório no GitHub e Subir o Código

1. Acesse o [GitHub](https://github.com) e entre na sua conta.
2. No canto superior direito, clique no botão **"+"** e selecione **"New repository"**.
3. Dê o nome de `sistema-estaleiros`, marque como **Public** ou **Private** e clique em **"Create repository"**.
4. No seu computador, abra o terminal na pasta do projeto e rode:

```bash
git init
git add .
git commit -m "Versao inicial do sistema de estaleiros"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/sistema-estaleiros.git
git push -u origin main
```

*(Ou você pode simplesmente clicar em **"uploading an existing file"** na página do GitHub e arrastar todos os arquivos da pasta do projeto).*

---

### PASSO 7: Colocar o Sistema no Ar Gratuitamente (Deploy)

Você pode usar o **Vercel**, **Netlify** ou **GitHub Pages**:

#### Opção Recomendada: Vercel (1 Clique)
1. Acesse [vercel.com](https://vercel.com) e faça login com seu GitHub.
2. Clique em **"Add New"** -> **"Project"**.
3. Importe o repositório `sistema-estaleiros`.
4. Clique em **"Deploy"**. Seu sistema estará online em segundos com um link `.vercel.app`.

---

## 📲 Como Utilizar o Sistema na Prática

1. **Acessar por Estaleiro via QR Code**:
   - Acesse o link `https://seu-dominio.com/?e=7` para abrir direto no **Estaleiro 07**.
2. **Entrar no Sistema**:
   - Digite seu e-mail e senha cadastrados no Supabase.
3. **Imprimir Placas de QR Code**:
   - Entre como Admin, vá na aba **"QR e placas"**.
   - Clique em **"Imprimir todas as placas"** para gerar um documento PDF/A4 pronto para gráfica ou impressão local com a logo da JPatrício Metais.

---

## 🛠️ Tecnologias Utilizadas

- **Front-end**: HTML5 Semântico, CSS Vanilla com Flexbox/Grid, JavaScript ES6+, Arquitetura Reativa leve (DCLogic).
- **Backend / Banco de Dados**: Supabase (PostgreSQL, Realtime APIs, RLS, Auth).
- **QR Code**: qrcode-generator SVG.
