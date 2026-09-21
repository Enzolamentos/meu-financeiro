# Meu Financeiro — PWA

Aplicativo pessoal de controle financeiro, pensado para celular.

## Recursos desta versão
- Dashboard com saldo, entradas e gastos do mês
- Lançamentos de receitas e despesas
- Categorias
- Vencimentos
- Gastos recorrentes
- Cadastro de cartões
- Orçamento mensal por categoria
- Backup e restauração em JSON
- Instalação como PWA
- Funcionamento offline após o primeiro acesso
- Dados salvos localmente no navegador

## Como testar no computador
Você precisa servir a pasta por HTTP. Exemplo com Python:

    python -m http.server 8000

Depois abra:
    http://localhost:8000

## Como instalar no celular
Para instalação como aplicativo, publique a pasta em um endereço HTTPS.
Opções gratuitas comuns:
- GitHub Pages
- Netlify
- Vercel

Depois abra o endereço no celular e use "Adicionar à tela inicial" ou o botão "Instalar", quando disponível.

## Segurança
Esta primeira versão NÃO conecta com bancos e NÃO usa Open Finance.
Os dados ficam no armazenamento local do navegador/aparelho.
Use o botão de backup periodicamente.

## Próximos passos possíveis
- Login e sincronização entre aparelhos
- Banco de dados online
- Importação CSV/OFX
- Parcelamento de compras
- Faturas separadas por cartão
- Contas bancárias
- Metas
- Gráficos avançados
- Chat financeiro
- Integração Open Finance por provedor autorizado
