# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A equipe financeira, gestores e supervisores da Construtec usam o sistema no trabalho diário para registrar, acompanhar e conferir a operação financeira de obras e centros de custo. Administradores também gerenciam usuários, segurança, backups e configurações da instalação.

## Product Purpose

Centralizar lançamentos, cobranças, documentos, conciliação e prestação de contas por obra. O produto deve manter dados confiáveis, reduzir retrabalho e permitir que a operação continue mesmo sem internet.

## Positioning

Gestão financeira orientada às obras da Construtec, com operação local-first, banco por instalação e sincronização controlada entre instalações ou com serviços corporativos opcionais.

## Operating Context

O uso principal ocorre em computadores Windows da empresa. A rotina inclui cadastro de obras, clientes, categorias e fornecedores; registro e liquidação de receitas e despesas; acompanhamento mensal; cobrança de clientes; anexos e notas fiscais; exportação para Excel; fechamento mensal; conciliação; sincronização e backup. Uma versão web responsiva para celular está prevista no roadmap.

## Capabilities and Constraints

- Interface e conteúdo em português do Brasil, com valores em reais e datas locais.
- Perfis de administrador, gestor e supervisor com permissões diferentes.
- Frontend web em HTML, CSS e JavaScript, distribuído atualmente em aplicativo Electron para Windows.
- Backend Node.js/Express, autenticação JWT e banco local PGlite.
- Recursos principais funcionam offline; sincronização corporativa, reports, cobrança por e-mail e atualizações dependem de serviços externos configurados.
- Alterações, conflitos, exclusões, estornos, documentos e backups devem preservar rastreabilidade.
- A porta local não deve ser exposta diretamente à internet; acesso remoto futuro exige hospedagem segura e HTTPS.

## Brand Commitments

Preservar o nome Centro de Custos Construtec, a identidade oficial da Construtec e os ativos existentes em `public/assets/construtec-logo.png` e `public/assets/construtec-favicon.png`. A comunicação deve ser direta, profissional e operacional.

## Evidence on Hand

- Descrição funcional e limitações documentadas em `README.md`.
- Fluxos, textos e estados reais em `public/index.html` e nos módulos de `public/`.
- Regras de negócio e permissões implementadas em `routes/`, `services/` e `migrations/`.
- Roadmap registrado em `docs/notas-desenvolvimento/ROADMAP-RESTANTE.md`.
- Não há depoimentos, métricas comerciais ou benchmarks aprovados; trabalhos futuros não devem inventá-los.

## Product Principles

1. Confiabilidade financeira antes de conveniência.
2. Rastreabilidade clara para toda alteração relevante.
3. Operação simples e contínua, inclusive sem internet.
4. Informação organizada por obra e pronta para prestação de contas.
5. Segurança e permissões proporcionais à responsabilidade de cada usuário.
