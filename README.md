# Meu Financeiro — PWA V2.2

Aplicativo pessoal de controle financeiro, pensado para celular e funcionamento offline.

## Novidades da V2.2
- Contas financeiras com saldo inicial e saldo calculado
- Lançamentos em débito/Pix, dinheiro ou cartão de crédito
- Uso normal sem cartão de crédito: basta escolher Débito / Pix e a conta
- Edição de lançamentos
- Exclusão com confirmação e opção de desfazer
- Filtros por mês, categoria, tipo e conta/cartão
- Navegação entre meses no dashboard e orçamento
- Categorias personalizadas com renomeação
- Recorrências mensais automáticas até a data atual
- Dashboard com orçamento consumido e maior categoria de gastos
- Cartões opcionais com cálculo da fatura aberta pelo ciclo de fechamento/vencimento
- Backup JSON com metadados, versão e compatibilidade com backups antigos
- Migração automática dos dados da V2.1 sem apagar o armazenamento existente

## Como lançar uma compra no débito
1. Toque em Novo lançamento.
2. Escolha Gasto.
3. Em Forma de pagamento, escolha Débito / Pix.
4. Escolha a conta de onde o dinheiro saiu.
5. Salve.

O valor é descontado imediatamente do saldo da conta. Não é necessário cadastrar cartão de crédito.

## Publicação
A pasta pode ser publicada diretamente no GitHub Pages. Substitua os arquivos da versão anterior pelos arquivos desta versão e mantenha a pasta `icons`.

## Segurança
A V2.2 ainda armazena os dados localmente no navegador/aparelho. Não há conexão bancária nem Open Finance. Faça backups periódicos.

## Próxima etapa sugerida
A V3 pode adicionar login, banco de dados online e sincronização entre dispositivos preservando a estrutura de contas, cartões, categorias e recorrências criada nesta versão.
